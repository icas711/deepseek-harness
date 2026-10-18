/**
 * tasks domain contract: список СВОИХ задач супервизора и возобновление
 * прерванной. Владелец задачи — владелец её сессии, и изоляция строже
 * кабинетной: даже админ видит только свои задачи, потому что возобновление
 * запускает работу на чужом списке. Задачи без веб-личности (TUI, in-process)
 * не изолируются — как весь остальной список сессий. Никакой изменяемой
 * поверхности, кроме resume: отметку завершённой клиент не передаёт, исход
 * работы — факт хоста.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Вид одной задачи супервизора для wire и UI (зеркало записи реестра). */
export interface TaskViewWire {
  /** Непрозрачный идентификатор задачи. */
  taskId: string
  /** Сессия, чей агент исполняет (или исполнял) работу. */
  sessionId: string
  /** Понятная метка работы (первый промпт сессии, усечённый). */
  title: string
  /** Жизненный цикл: running | paused | waiting-station | interrupted | completed | failed. */
  status: 'running' | 'paused' | 'interrupted' | 'waiting-station' | 'completed' | 'failed'
  /** Эпоха в миллисекундах последней смены статуса или метки. */
  updatedAt: number
  /** Станция исполнения, когда работа привязана к станции. */
  stationId?: string
}

/** tasks domain unary methods (the map keys tasks.* of RpcMethodMap). */
export interface TasksApi {
  /**
   * Задачи вызывающего веб-пользователя (владелец задачи — владелец сессии по
   * кабинетному правилу), упорядоченные по времени изменения. Вне веб-запроса
   * отвечает весь реестр.
   */
  list(request: RpcRequest<{}>): Promise<RpcResponse<{ tasks: TaskViewWire[] }>>

  /**
   * Возобновить прерванную (interrupted/paused/waiting-station) задачу:
   * сессия переоткрывается, и в неё доставляется продолжение. Чужой или
   * неизвестный идентификатор отвечает `tasks-task-not-found`.
   */
  resume(request: RpcRequest<{ taskId: string }>): Promise<RpcResponse<{}>>
}
