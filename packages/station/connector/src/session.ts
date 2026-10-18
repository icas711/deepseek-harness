/**
 * Клиентская сторона моста: исходящее WSS-соединение к оркестратору,
 * приветствие (сопряжение или токен), dispatch операций исполнителю
 * и переподключение с бэкоффом. Отказы аутентификации и версии
 * протокола — постоянные: повтор не поможет, цикл завершается ошибкой.
 * @module @deepseek-ai/dsh-station-connector/session
 */

import WebSocket from 'ws'
import {
  decodeStationText,
  STATION_PROTOCOL_VERSION,
  StationPathError,
  StationProtocolError,
  assertNever,
} from '@deepseek-ai/dsh-station-protocol'
import type { StationFrame, StationHelloAuth, StationOpName } from '@deepseek-ai/dsh-station-protocol'
import { nextBackoffMs } from './backoff.ts'
import type { StationExecutor } from './executor.ts'

/** Постоянный отказ: повторные попытки бессмысленны, нужно действие человека. */
export class StationRejectedError extends Error {
  /** Причина из кадра reject. */
  readonly reason: string

  /**
   * Собирает постоянный отказ приветствия.
   * @param reason - причина из протокола.
   * @param message - человекочитаемый текст на русском.
   */
  constructor(reason: string, message: string) {
    super(message)
    this.name = 'StationRejectedError'
    this.reason = reason
  }
}

/** Жизненное состояние сессии для CLI-статусов. */
export type ConnectorState = 'connecting' | 'online' | 'waiting' | 'stopped'

/** Опции цикла коннектора. */
export interface ConnectorLoopOptions {
  /** Полный URL WSS-маршрута хоста. */
  url: string
  /** Свежая аутентификация на каждую попытку (код гасится одним использованием). */
  auth: () => StationHelloAuth
  /** Исполнитель операций над корнем станции. */
  executor: StationExecutor
  /** Переподключаться ли после разрыва; false — одно соединение и выход. */
  reconnect: boolean
  /** Верхняя граница числа попыток подряд (тесты); undefined — бесконечно. */
  maxAttempts?: number
  /** Наблюдатель состояния для CLI-строк. */
  onState?: (state: ConnectorState, detail?: string) => void
  /** Крючок текущего сокета: события исполнителя едут в активное соединение. */
  socketHook?: (socket: WebSocket) => void
  /** Источник джиттера бэкоффа; по умолчанию Math.random. */
  random?: () => number
  /** Остановка цикла: сигнал отмены. */
  signal: AbortSignal
}

/**
 * Крутит цикл «соединение → приветствие → обслуживание» до отмены или
 * постоянного отказа. Разрывы сокета лечатся бэкоффом; reject и ошибки
 * протокола — постоянные отказы.
 * @param opts - параметры цикла.
 * @throws StationRejectedError — хост отказал (код, токен, версия);
 * @throws Error — исчерпаны попытки при включённом maxAttempts.
 */
export async function runConnectorLoop(opts: ConnectorLoopOptions): Promise<void> {
  let totalAttempts = 0
  let backoffAttempt = 0
  while (!opts.signal.aborted) {
    if (opts.maxAttempts !== undefined && totalAttempts >= opts.maxAttempts) {
      throw new Error(`station-connector: не удалось подключиться за ${String(opts.maxAttempts)} попыток`)
    }
    if (totalAttempts > 0) {
      // Каждый повтор, включая первый после долгого успешного сеанса,
      // ждёт бэкофф: экспонента считается от числа повторов подряд,
      // а успешный сеанс сбрасывает её в начало.
      const delay = nextBackoffMs(backoffAttempt, opts.random)
      opts.onState?.('waiting', `переподключение через ${String(delay)} мс`)
      const abortedDuringWait = await sleep(delay, opts.signal)
      if (abortedDuringWait) return
      backoffAttempt += 1
    }
    totalAttempts += 1
    opts.onState?.('connecting')
    const outcome = await serveOnce(opts)
    if (outcome.kind === 'permanent') throw outcome.error
    if (outcome.kind === 'served') backoffAttempt = 0
  }
}

/** Итог одного соединения: обслужено, оборвано или постоянный отказ. */
type ServeOutcome =
  | { kind: 'served' }
  | { kind: 'dropped' }
  | { kind: 'permanent'; error: unknown }

/** Итог ожидания: true — отменено сигналом, false — таймер истёк. */
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { done(false) }, ms)
    function done(aborted: boolean): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(aborted)
    }
    const onAbort = (): void => { done(true) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function serveOnce(opts: ConnectorLoopOptions): Promise<ServeOutcome> {
  return new Promise<ServeOutcome>((resolve) => {
    let settled = false
    let served = false
    const ws = new WebSocket(opts.url)
    const finish = (outcome: ServeOutcome): void => {
      if (settled) return
      settled = true
      opts.signal.removeEventListener('abort', onAbort)
      try {
        ws.close()
      } catch {
        // Сокет уже мёртв — это и есть причина завершения.
      }
      resolve(outcome)
    }
    const onAbort = (): void => { finish({ kind: 'dropped' }) }
    opts.signal.addEventListener('abort', onAbort, { once: true })

    ws.on('open', () => {
      opts.socketHook?.(ws)
      ws.send(JSON.stringify({ t: 'hello', version: STATION_PROTOCOL_VERSION, auth: opts.auth() }))
    })
    ws.on('message', (data: Buffer) => {
      void handleMessage(data)
    })
    ws.on('close', () => {
      finish(served ? { kind: 'served' } : { kind: 'dropped' })
    })
    ws.on('error', (error) => {
      // Ошибка транспорта до установления — тоже обрыв: бэкофф продолжит.
      if (!settled) finish({ kind: 'dropped' })
      void error
    })

    async function handleMessage(data: Buffer): Promise<void> {
      let frame: StationFrame
      try {
        frame = decodeStationText(data.toString('utf8'))
      } catch (error) {
        // Отправитель вне формата: соединение не имеет смысла.
        opts.onState?.('stopped', error instanceof Error ? error.message : String(error))
        finish({ kind: 'permanent', error })
        return
      }
      switch (frame.t) {
        case 'welcome':
          opts.onState?.('online')
          served = true
          return
        case 'reject':
          opts.onState?.('stopped', frame.message)
          finish({ kind: 'permanent', error: new StationRejectedError(frame.reason, frame.message) })
          return
        case 'req':
          await answer(frame.op, frame.p, frame.id)
          return
        case 'hello':
        case 'res':
        case 'evt':
          // Коннектор не получает эти кадры: хост вне своей роли.
          finish({ kind: 'permanent', error: new StationProtocolError(`кадр ${frame.t} недопустим от хоста`) })
          return
        default:
          return assertNever(frame)
      }
    }

    async function answer(op: StationOpName, payload: unknown, id: string): Promise<void> {
      try {
        const value = await opts.executor.dispatch(op, payload as never)
        ws.send(JSON.stringify({ t: 'res', id, ok: true, value }))
      } catch (error) {
        const remote = toRemoteError(error)
        ws.send(JSON.stringify({ t: 'res', id, ok: false, error: { code: remote.code, message: remote.message } }))
      }
    }
  })
}

/** Любой отказ операции сводится к стабильному коду протокола. */
function toRemoteError(error: unknown): { code: string; message: string } {
  if (error instanceof StationPathError) return { code: 'denied', message: error.message }
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error
    && typeof (error as { code?: unknown }).code === 'string') {
    const typed = error as { code: string; message: string }
    return { code: typed.code, message: typed.message }
  }
  return { code: 'io', message: error instanceof Error ? error.message : String(error) }
}
