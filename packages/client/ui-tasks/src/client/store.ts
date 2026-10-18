/**
 * Контроллер страницы «Задачи»: единственный источник факта — хост. Список
 * читается через tasks.list (изоляция на хосте), возобновление — через
 * tasks.resume с перечитыванием; отметку завершённой ставит только хост по
 * исходу turn'а, поэтому такой кнопки нет.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { TaskViewWire } from '@deepseek-ai/dsh-host-apiproxy/api'

/** Строка списка задач (зеркало доменного контракта). */
export type TaskRow = TaskViewWire

/** Статусы, для которых «Продолжить» имеет смысл: работа стоит и может пойти. */
export const RESUMABLE_STATUSES: ReadonlySet<TaskRow['status']> = new Set(['interrupted', 'paused', 'waiting-station'])

/** Снимок страницы задач. */
export interface TasksState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Текст неудачи загрузки или последней операции. */
  error: string | null
  tasks: readonly TaskRow[]
  /** Идентификатор задачи, для которой прямо сейчас идёт resume. */
  busyTaskId: string | null
}

/** Начальный снимок. */
export const INITIAL_STATE: TasksState = {
  status: 'idle',
  error: null,
  tasks: [],
  busyTaskId: null,
}

/** Сообщение об отказе вызова: текст хоста, а не внутреннее представление. */
export function messageOf(result: { ok: true } | { ok: false; error: { message: string } }): string | null {
  return result.ok ? null : result.error.message
}

/**
 * «Обновлено» по-русски: относительное время одной строкой.
 * @param updatedAt - эпоха в миллисекундах.
 * @param now - текущая эпоха в миллисекундах (тесты подставляют).
 * @returns короткая человеческая метка.
 */
export function relativeWhen(updatedAt: number, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - updatedAt) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return 'minutesAgo'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return 'hoursAgo'
  return 'daysAgo'
}

/** Параметры подстановки для словарной метки относительного времени. */
export function whenParams(kind: string, updatedAt: number, now: number = Date.now()): Record<string, number> {
  if (kind === 'minutesAgo') return { count: Math.max(1, Math.floor((now - updatedAt) / 60_000)) }
  if (kind === 'hoursAgo') return { count: Math.floor((now - updatedAt) / 3_600_000) }
  return { count: Math.floor((now - updatedAt) / 86_400_000) }
}

/**
 * Контроллер страницы: читает список и возобновляет стоящие задачи. Хост
 * остаётся единственным источником факта — после resume список перечитывается.
 */
export class TasksController {
  /** Снимок страницы (источник хука рендера). */
  readonly store: SnapshotStore<TasksState> = createSnapshotStore(INITIAL_STATE)

  /**
   * @param api - транспорт задач.
   */
  constructor(private readonly api: Pick<IApiClient, 'tasks'>) {}

  /** Прочитать список своих задач. */
  async load(): Promise<void> {
    const snapshot = this.store.getSnapshot()
    if (snapshot.status === 'idle') {
      this.store.update((state) => { state.status = 'loading' })
    }
    const response = await this.api.tasks.list({})
    if (!response.result.ok) {
      const failure = response.result.error
      this.store.update((state) => {
        state.status = 'error'
        state.error = failure.message
      })
      return
    }
    const tasks = response.result.value.tasks
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.tasks = tasks
    })
  }

  /**
   * Возобновить стоящую задачу (interrupted/paused/waiting-station) и
   * перечитать список; чужой или неизвестный идентификатор — отказ хоста.
   * Текст неудачи ставится ПОСЛЕ перечитывания: перезагрузка списка не должна
   * стирать отзыв о самом действии пользователя.
   * @param taskId - задача для продолжения.
   */
  async resume(taskId: string): Promise<void> {
    this.store.update((state) => {
      state.busyTaskId = taskId
      state.error = null
    })
    const response = await this.api.tasks.resume({ taskId })
    this.store.update((state) => {
      state.busyTaskId = null
    })
    await this.load()
    if (!response.result.ok) {
      this.store.update((state) => {
        state.error = messageOf(response.result)
      })
    }
  }
}
