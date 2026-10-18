/**
 * Проводка супервизора задач (ctx.taskSupervisor) в шлюз: принятый промпт —
 * регистрация задачи, исход turn'а — её завершение. Локальные сессии и сессии
 * со станцией ведутся одинаково (у станционных запись несёт stationId), так
 * что страница «Задачи» едина. Всё fail-soft: задача — побочный продукт
 * prompting'а, и отказ трекинга (остановка супервизора, недоступный реестр)
 * никогда не рвёт сам turn.
 * @module ./task-tracking.ts
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolve `ctx.get('taskSupervisor')` и статусные типы реестра.
import type {} from '@deepseek-ai/dsh-task-supervisor'
import { TaskId, TaskSupervisorError } from '@deepseek-ai/dsh-task-supervisor'
import type { TaskView } from '@deepseek-ai/dsh-task-supervisor'
import type { StationId } from '@deepseek-ai/dsh-station-protocol'
import type { SessionId, TurnEndReason } from '@deepseek-ai/dsh-session'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { truncateUnicodeCodePoints } from './api/session-search.ts'

/** Лимит метки задачи в символах Unicode — первый промпт сессии, одна строка. */
export const TASK_TITLE_MAX_CODE_POINTS = 80

/** Активные (нетерминальные) статусы записи реестра. */
function isActive(status: TaskView['status']): boolean {
  return status === 'running' || status === 'paused' || status === 'interrupted' || status === 'waiting-station'
}

/**
 * Метка задачи из первого промпта: однострочный текст текстовых частей,
 * усечённый по границе кодовой точки.
 * @param promptText - сырый текст промпта (склейка текстовых частей).
 * @returns метка реестра.
 */
export function taskTitle(promptText: string): string {
  const flat = promptText.replace(/\s+/gu, ' ').trim()
  if (flat === '') return 'Задача без названия'
  return truncateUnicodeCodePoints(flat, TASK_TITLE_MAX_CODE_POINTS)
}

/** Состояние проводки: taskId по сессии + известные из реестра привязки. */
export interface TaskTracking {
  /**
   * Зарегистрировать (или переиспользовать активную) задачу сессии после
   * принятого промпта. Активная запись не переметивается — метка задачи это
   * ПЕРВЫЙ промпт; завершённая запись сменяется новой задачей при следующем
   * промпте. Станционная привязка берётся из факта создания сессии, а при
   * его отсутствии — из записи реестра (перезапуск процесса).
   * @param ctx - контекст шлюза (читает taskSupervisor).
   * @param sessionId - сессия, в которую принят промпт.
   * @param title - сырый текст промпта (усекается здесь).
   * @param stationIdFromCreate - станция из executionTarget session.create, когда известна.
   */
  trackAcceptedPrompt(ctx: Context, sessionId: SessionId, title: string, stationIdFromCreate: StationId | undefined): Promise<void>

  /**
   * Завершить задачу сессии по исходу turn'а: completed — нормальный исход,
   * failed — ошибочный; отмена и blocked оставляют задачу running (работа
   * не закончена и не провалена). Синхронного активного знания нет — запись
   * ищется в реестре (один листинг кэшируется).
   * @param ctx - контекст шлюза (читает taskSupervisor).
   * @param sessionId - сессия, чей turn закончился.
   * @param reason - исход turn'а из события turn/end.
   */
  settleTurnEnd(ctx: Context, sessionId: SessionId, reason: TurnEndReason): Promise<void>
}

/** Создать состояние проводки для одного шлюза. */
export function createTaskTracking(): TaskTracking {
  /** Активные записи этого процесса: сессия → taskId. */
  const active = new Map<SessionId, TaskId>()
  /** Завершённые в этом процессе: сессия → true (следующий промпт заводит новую задачу). */
  const settled = new Set<SessionId>()
  /** Кэш листинга реестра между промптами (перезапуск процесса, settle). */
  let registryCache: Promise<TaskView[]> | undefined

  const listRegistry = (supervisor: { list(): Promise<TaskView[]> }): Promise<TaskView[]> => {
    registryCache ??= supervisor.list()
    return registryCache
  }

  return {
    async trackAcceptedPrompt(ctx, sessionId, title, stationIdFromCreate) {
      const supervisor = ctx.get('taskSupervisor')
      if (supervisor === undefined) return
      // Активная запись не переметивается: метка задачи — ПЕРВЫЙ промпт сессии.
      if (active.has(sessionId)) return
      try {
        // Знания этого процесса нет: реестр может держать активную запись с
        // прошлого процесса (тогда она переиспользуется со своей станцией);
        // завершённая — не мешает завести новую задачу.
        if (!settled.has(sessionId)) {
          const known = (await listRegistry(supervisor)).find(record => record.sessionId === sessionId && isActive(record.status))
          if (known !== undefined) {
            active.set(sessionId, known.taskId)
            return
          }
        }
        const record = await supervisor.track({
          sessionId,
          title: taskTitle(title),
          ...(stationIdFromCreate === undefined ? {} : { stationId: stationIdFromCreate }),
        })
        active.set(sessionId, record.taskId)
        settled.delete(sessionId)
        registryCache = undefined
      } catch (error) {
        if (error instanceof TaskSupervisorError && error.code === 'stopping') return
        ctx.logger.warn(`api-proxy: трекинг задачи сессии "${sessionId}" не выполнен: ${error instanceof Error ? error.message : String(error)}`)
      }
    },

    async settleTurnEnd(ctx, sessionId, reason) {
      const supervisor = ctx.get('taskSupervisor')
      if (supervisor === undefined) return
      const taskId = active.get(sessionId)
      if (taskId === undefined) return
      try {
        if (reason.kind === 'completed') {
          await supervisor.markCompleted(taskId)
        } else if (reason.kind === 'error') {
          await supervisor.markFailed(taskId, errorChain(reason.error))
        } else {
          // Отмена и blocked: работа не завершена и не провалена, задача
          // остаётся running до исхода следующего turn'а.
          return
        }
        active.delete(sessionId)
        settled.add(sessionId)
        registryCache = undefined
      } catch (error) {
        if (error instanceof TaskSupervisorError && (error.code === 'stopping' || error.code === 'unknown-task')) return
        ctx.logger.warn(`api-proxy: завершение задачи сессии "${sessionId}" не записано: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}
