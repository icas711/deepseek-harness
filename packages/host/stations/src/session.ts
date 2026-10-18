/**
 * Хост-сессия моста: серверная сторона протокола поверх одного WebSocket.
 * Ведёт приветствие (сопряжение или токен), корреляцию запрос/ответ по id
 * и рассылку событий процессов подписчикам — потребителям-провайдерам.
 * @module @deepseek-ai/dsh-stations/session
 */

import { randomUUID } from 'node:crypto'
import { StationOpRemoteError, StationProtocolError, decodeStationText, STATION_PROTOCOL_VERSION } from '@deepseek-ai/dsh-station-protocol'
import type {
  StationEventFrame,
  StationFrame,
  StationId,
  StationOpName,
  StationOpPayloadMap,
  StationOpValueMap,
  StationPlatform,
} from '@deepseek-ai/dsh-station-protocol'

/** Минимальный транспорт сессии: WebSocket ему структурно удовлетворяет. */
export interface StationSocket {
  /**
   * Отправляет один текстовый кадр.
   * @param data - сериализованный кадр протокола.
   */
  send(data: string): void
  /**
   * Закрывает соединение с кодом и причиной.
   * @param code - код закрытия WebSocket.
   * @param data - человекочитаемая причина.
   */
  close(code?: number, data?: string): void
}

/** Службы, к которым сессия обращается при приветствии и в работе. */
export interface StationSessionHost {
  /**
   * Завершает сопряжение по одноразовому коду.
   * @param code - код из beginPairing.
   * @param stationName - имя станции от коннектора.
   * @param rootPath - корневая папка от коннектора.
   * @param platform - платформа станции.
   * @returns идентификатор, токен и эхо корня, либо ошибку сервиса.
   */
  completePairing(code: string, stationName: string, rootPath: string, platform: StationPlatform):
  Promise<{ stationId: StationId; token: string; rootPath: string }>
  /**
   * Проверяет токен станции (timing-safe сравнение хэша).
   * @param token - предъявленный токен.
   * @returns запись станции или undefined.
   */
  verifyStationToken(token: string): { stationId: StationId; rootPath: string; platform: StationPlatform } | undefined
  /**
   * Отмечает выход станции на связь; вызов после welcome. Сессия
   * передаёт себя, чтобы сервис мог заменить прежнее соединение.
   * @param stationId - станция, чьё соединение открылось.
   * @param session - открывшаяся сессия.
   */
  markOnline(stationId: StationId, session: StationServerSession): void
  /**
   * Отмечает разрыв соединения; вызов при закрытии сокета. Сессия
   * передаёт себя, чтобы сервис различил заменённую и живую сессию.
   * @param stationId - станция, чьё соединение закрылось.
   * @param session - закрывающаяся сессия.
   */
  markOffline(stationId: StationId, session: StationServerSession): void
  /**
   * Наблюдаемо логирует нарушение протокола или сервиса сессии.
   * @param error - зафиксированная ошибка.
   */
  logError(error: unknown): void
}

/** Отказ, который сессия возвращает ожидающим запросам при разрыве. */
export class StationBridgeClosedError extends Error {
  constructor(message = 'соединение со станцией закрыто') {
    super(message)
    this.name = 'StationBridgeClosedError'
  }
}

/**
 * Один живой мост к станции. Ровно одна сессия на сокет; после welcome
 * сессия публикуется как мост провайдерам и обслуживает запросы, пока
 * сокет не закроется — тогда все ожидающие получают StationBridgeClosedError.
 */
export class StationServerSession {
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>()
  private readonly eventHandlers = new Set<(event: StationEventFrame) => void>()
  private settled = false
  /** Идентификатор станции после успешного приветствия; до него undefined. */
  stationId: StationId | undefined
  /** Корень станции после приветствия; до него undefined. */
  rootPath: string | undefined
  /** Платформа станции после приветствия; до него undefined. */
  platform: StationPlatform | undefined

  /**
   * Строит сессию и сразу передаёт ей управление приветствием.
   * @param socket - транспорт (WebSocket в композиции, двойник в тестах).
   * @param host - службы хоста, к которым сессия обращается.
   */
  constructor(private readonly socket: StationSocket, private readonly host: StationSessionHost) {}

  /**
   * Обрабатывает одно текстовое сообщение сокета. Нарушение протокола —
   * немедленное закрытие: отправитель кадров вне формата не уговаривается.
   * @param text - сырое текстовое сообщение.
   */
  handleMessage(text: string): void {
    let frame: StationFrame
    try {
      frame = decodeStationText(text)
    } catch (error) {
      this.fail(error instanceof Error ? error : new StationProtocolError(String(error)))
      return
    }
    switch (frame.t) {
      case 'hello':
        // Приветствие асинхронно; его отказы уходят в сокет сами.
        void this.handleHello(frame)
        return
      case 'res': {
        const waiting = this.pending.get(frame.id)
        if (waiting === undefined) {
          // Ответ на неизвестный id: соединение прозрачно, но это аномалия,
          // которую терять нельзя — наблюдаемо логируем и продолжаем.
          this.host.logError(new StationProtocolError(`res: неизвестный id корреляции ${frame.id}`))
          return
        }
        this.pending.delete(frame.id)
        if (frame.ok) waiting.resolve(frame.value)
        else waiting.reject(new StationOpRemoteError(frame.error.code, frame.error.message))
        return
      }
      case 'evt':
        for (const handler of this.eventHandlers) handler(frame)
        return
      case 'welcome':
      case 'reject':
      case 'req':
        // Хост никогда не получает эти кадры от коннектора: нарушение ролей.
        this.fail(new StationProtocolError(`кадр ${frame.t} недопустим от коннектора`))
        return
      default:
        this.fail(new StationProtocolError('неизвестный кадр'))
    }
  }

  /**
   * Обрабатывает закрытие сокета: все ожидающие запросы и подписчики
   * получают отказ, станция помечается офлайн.
   */
  handleClose(): void {
    if (this.settled) return
    this.settled = true
    if (this.stationId !== undefined) this.host.markOffline(this.stationId, this)
    const waiting = [...this.pending.values()]
    this.pending.clear()
    for (const entry of waiting) entry.reject(new StationBridgeClosedError())
  }

  /**
   * Выполняет одну операцию на станции и ждёт ответ с тем же id.
   * @param op - имя операции из закрытого юниона протокола.
   * @param payload - типизированная полезная нагрузка операции.
   * @param opts - отмена через AbortSignal.
   * @returns значение ответа, суженное по операции.
   * @throws StationOpRemoteError — отказ операции на станции;
   * @throws StationBridgeClosedError — соединение закрыто до ответа;
   * @throws станция ещё не прошла приветствие.
   */
  async request<K extends StationOpName>(
    op: K,
    payload: StationOpPayloadMap[K],
    opts?: { signal?: AbortSignal },
  ): Promise<StationOpValueMap[K]> {
    if (this.stationId === undefined) throw new StationBridgeClosedError('станция ещё не прошла приветствие')
    if (this.settled) throw new StationBridgeClosedError()
    opts?.signal?.throwIfAborted()
    const id = randomUUID()
    const done = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    const onAbort = (): void => {
      const waiting = this.pending.get(id)
      if (waiting === undefined) return
      this.pending.delete(id)
      waiting.reject(opts?.signal?.reason instanceof Error ? opts.signal.reason : new StationBridgeClosedError('запрос отменён'))
    }
    opts?.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      this.socket.send(JSON.stringify({ t: 'req', id, op, p: payload }))
      return await done as StationOpValueMap[K]
    } finally {
      opts?.signal?.removeEventListener('abort', onAbort)
      this.pending.delete(id)
    }
  }

  /**
   * Подписывается на события коннектора (stdout/stderr/exit).
   * @param handler - обработчик проверенного кадра события.
   * @returns диспозер подписки.
   */
  onEvent(handler: (event: StationEventFrame) => void): () => void {
    this.eventHandlers.add(handler)
    return () => {
      this.eventHandlers.delete(handler)
    }
  }

  /** Живёт ли сессия: приветствие пройдено, сокет не закрыт. */
  get alive(): boolean {
    return !this.settled && this.stationId !== undefined
  }

  private async handleHello(frame: Extract<StationFrame, { t: 'hello' }>): Promise<void> {
    if (frame.version !== STATION_PROTOCOL_VERSION) {
      this.rejectAndClose('protocol-version', `версия протокола ${String(frame.version)} не поддерживается, ожидается ${String(STATION_PROTOCOL_VERSION)}`)
      return
    }
    try {
      if (frame.auth.mode === 'pair') {
        const { stationId, token, rootPath } = await this.host.completePairing(
          frame.auth.code, frame.auth.stationName, frame.auth.rootPath, frame.auth.platform,
        )
        this.accept(stationId, rootPath, frame.auth.platform)
        // Токен едет коннектору ровно один раз — в ответе на сопряжение.
        this.socket.send(JSON.stringify({ t: 'welcome', stationId, rootPath, token }))
        return
      }
      const verified = this.host.verifyStationToken(frame.auth.token)
      if (verified === undefined) {
        this.rejectAndClose('bad-token', 'токен станции не принят: переподключение не поможет, нужно повторное сопряжение')
        return
      }
      this.accept(verified.stationId, verified.rootPath, verified.platform)
      this.socket.send(JSON.stringify({ t: 'welcome', stationId: verified.stationId, rootPath: verified.rootPath }))
    } catch (error) {
      this.rejectAndClose('bad-code', error instanceof Error ? error.message : String(error))
    }
  }

  private accept(stationId: StationId, rootPath: string, platform: StationPlatform): void {
    this.stationId = stationId
    this.rootPath = rootPath
    this.platform = platform
    this.host.markOnline(stationId, this)
  }

  private rejectAndClose(reason: Extract<StationFrame, { t: 'reject' }>['reason'], message: string): void {
    this.socket.send(JSON.stringify({ t: 'reject', reason, message }))
    this.socket.close(4001, reason)
    this.handleClose()
  }

  private fail(error: unknown): void {
    this.host.logError(error)
    this.socket.close(4002, 'protocol-error')
    this.handleClose()
  }
}

