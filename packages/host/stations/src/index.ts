/**
 * Хост-сторона моста станций (`ctx.stations`): сервис сопряжения,
 * долговременный реестр `station-registry.json` и upgrade-маршрут
 * `/station-ws`, поверх которого ходит проводной протокол. Пассивен
 * без пар: реестр читается при активации, соединений и таймеров нет,
 * пока пользователь не запросит код сопряжения.
 * @module @deepseek-ai/dsh-stations
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { posix, win32 } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { mintPairingCode, STATION_WS_PATH, StationId } from '@deepseek-ai/dsh-station-protocol'
import type { StationEventFrame, StationOpName, StationOpPayloadMap, StationOpValueMap, StationPlatform } from '@deepseek-ai/dsh-station-protocol'
import type { WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import WebSocket, { WebSocketServer } from 'ws'
import { StationRegistryStore } from './registry.ts'
import { StationServerSession } from './session.ts'
import { StationsError } from './types.ts'
import type { PendingPairing, StationRecord, StationView } from './types.ts'

export { STATION_WS_PATH } from '@deepseek-ai/dsh-station-protocol'
export { StationOpRemoteError } from '@deepseek-ai/dsh-station-protocol'
export { StationBridgeClosedError, StationServerSession } from './session.ts'
export { RegistryFileError, parseRegistryDocument, serializeRegistryDocument } from './registry.ts'
export { StationsError } from './types.ts'
export type { PendingPairing, StationRecord, StationView, StationsErrorCode } from './types.ts'

/** Конфигурация сервиса станций: состав поставляет пути развёртывания. */
export interface Config {
  /**
   * Путь документа реестра станций. Обязателен (без умолчания): реестр
   * несёт привязки станций к логинам и хэши токенов, поэтому место
   * указывается явно — композиции передают dshHomePath('station-registry.json').
   */
  registryPath: string
  /** Время жизни одноразового кода сопряжения в миллисекундах. */
  pairingCodeTtlMs?: number
}

/** Умолчание TTL кода сопряжения: десять минут на ввод и запуск коннектора. */
const DEFAULT_PAIRING_TTL_MS = 600_000

/** Имя станции: до 64 знаков без управляющих символов. */
/** Управляющие символы ASCII запрещены в имени станции. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function validStationName(name: string): boolean {
  return name.length > 0 && name.length <= 64 && !CONTROL_CHARS.test(name)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Мост станций: сопряжение, реестр и живые соединения. */
    stations: StationsService
  }

  interface Events {
    /**
     * Онлайн-статус станции сменился: соединение коннектора открылось после
     * приветствия или закрылось. Замена одного живого соединения другим
     * (свежее выигрывает) статус не меняет и события не поднимает.
     * Подписчики: супервизор задач (перевод привязанных задач в офлайн-ожидание
     * и автопродолжение при возврате) и наблюдатели уведомлений.
     * @param payload - станция и её новое состояние: `{ stationId, online }`.
     * @mode emit
     */
    'station/status'(payload: { stationId: StationId; online: boolean }): void
  }
}

/**
 * Живой мост к станции для провайдеров: те же швы используют его вместо
 * локального мира. Операции типизированы по имени, события приходят
 * подписчикам, закрытие сокета отклоняет все ожидающие запросы.
 */
export interface StationBridge {
  /** Идентификатор станции из реестра. */
  readonly stationId: StationId
  /** Платформа станции — владелец правил разбора путей. */
  readonly platform: StationPlatform
  /** Корневая папка станции. */
  readonly rootPath: string
  /**
   * Выполняет одну операцию на станции.
   * @param op - имя операции протокола.
   * @param payload - типизированная полезная нагрузка.
   * @param opts - отмена через AbortSignal.
   * @returns значение ответа, суженное по операции.
   */
  request<K extends StationOpName>(
    op: K,
    payload: StationOpPayloadMap[K],
    opts?: { signal?: AbortSignal },
  ): Promise<StationOpValueMap[K]>
  /**
   * Подписывается на события коннектора.
   * @param handler - обработчик проверенного кадра события.
   * @returns диспозер подписки.
   */
  onEvent(handler: (event: StationEventFrame) => void): () => void
}

/**
 * Сервис станций. Владеет реестром, одноразовыми кодами сопряжения
 * (в памяти, с TTL) и живыми сессиями-мостами; upgrade-маршрут
 * регистрирует на веб-сервере при активации. Токены хранятся только
 * хэшированными: полный токен едет коннектору ровно один раз.
 */
export class StationsService extends Service {
  static inject = ['webServer']

  static Config: z<Config> = z.object({
    registryPath: z.string().required(),
    pairingCodeTtlMs: z.natural().default(DEFAULT_PAIRING_TTL_MS),
  })

  private readonly store: StationRegistryStore
  private readonly pairings = new Map<string, PendingPairing>()
  private readonly sessions = new Map<string, StationServerSession>()
  private readonly pairingTtlMs: number
  private ready: Promise<void> = Promise.resolve()

  /**
   * Строит сервис; чтение реестра и регистрацию маршрута делает init.
   * @param ctx - контекст с веб-сервером.
   * @param config - проверенный конфиг.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'stations')
    // Schemastery заполняет поля до конструктора; тип этого не кодирует.
    // Ручной контекст без схемы получает документированное умолчание.
    const resolved = config as Config & { pairingCodeTtlMs?: number }
    const ttl = resolved.pairingCodeTtlMs ?? DEFAULT_PAIRING_TTL_MS
    if (!Number.isSafeInteger(ttl) || ttl <= 0) {
      throw new Error('stations: pairingCodeTtlMs должен быть положительным целым')
    }
    this.pairingTtlMs = ttl
    this.store = new StationRegistryStore({ filePath: config.registryPath })
  }

  /** Читает реестр и регистрирует upgrade-маршрут; сбой реестра валит загрузку. */
  protected async [Service.init](): Promise<void> {
    this.ready = this.store.load()
    await this.ready
    const webserver = new WebSocketServer({ noServer: true })
    const route: WebUpgradeRoute = {
      path: STATION_WS_PATH,
      handler: (req, socket, head) => {
        webserver.handleUpgrade(req, socket, head, (ws) => { this.attach(ws) })
      },
    }
    const disposeRoute = this.ctx.webServer.registerUpgrade(route)
    this.ctx.effect(() => () => {
      disposeRoute()
      for (const session of [...this.sessions.values()]) {
        session.handleClose()
      }
      webserver.close()
    }, 'stations: upgrade route and sessions')
  }

  /**
   * Выдаёт одноразовый код сопряжения для логина. Код живёт в памяти
   * с TTL; рестарт хоста его забывает — пользователь просто запрашивает
   * новый.
   * @param login - логин веб-пользователя, к которому привяжется станция.
   * @returns код и путь WSS-маршрута для коннектора.
   * @throws StationsError `bad-input` при пустом логине.
   */
  beginPairing(login: string): { code: string; wssPath: string } {
    if (typeof login !== 'string' || login.trim().length === 0) {
      throw new StationsError('логин сопряжения обязателен', 'bad-input')
    }
    this.sweepExpiredPairings()
    const code = mintPairingCode(randomBytes)
    this.pairings.set(code, { login, expiresAt: Date.now() + this.pairingTtlMs })
    return { code, wssPath: STATION_WS_PATH }
  }

  /**
   * Завершает сопряжение по одноразовому коду; вызывает сессия при
   * первом соединении коннектора. Код гасится одним использованием.
   * @param code - код из beginPairing.
   * @param stationName - имя станции от коннектора.
   * @param rootPath - корневая папка на станции.
   * @param platform - платформа станции.
   * @returns идентификатор, полный токен (только этот раз) и эхо корня.
   * @throws StationsError `bad-code` (неизвестен, протух или использован),
   * `bad-input` при недопустимом имени или корне.
   */
  async completePairing(
    code: string,
    stationName: string,
    rootPath: string,
    platform: StationPlatform,
  ): Promise<{ stationId: StationId; token: string; rootPath: string }> {
    const pending = this.pairings.get(code)
    if (pending === undefined || pending.expiresAt <= Date.now()) {
      this.pairings.delete(code)
      throw new StationsError('код сопряжения не принят: он истёк, использован или не выдавался', 'bad-code')
    }
    if (!validStationName(stationName)) {
      throw new StationsError('имя станции обязано быть непустой строкой до 64 знаков без управляющих символов', 'bad-input')
    }
    const absolute = platform === 'win32' ? win32.isAbsolute(rootPath) : posix.isAbsolute(rootPath)
    if (!absolute) {
      throw new StationsError(`корневая папка станции обязана быть абсолютным путём платформы ${platform}`, 'bad-input')
    }
    this.pairings.delete(code)
    const stationId = StationId(`stn-${randomUUID()}`)
    const token = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    await this.ready
    await this.store.add({ stationId, login: pending.login, name: stationName, rootPath, platform, tokenHash })
    this.ctx.logger.info(`stations: сопряжена станция «${stationName}» (${String(stationId)}) для ${pending.login}`)
    return { stationId, token, rootPath }
  }

  /**
   * Список станций логина, отсортированный по имени.
   * @param login - логин владельца; undefined означает все станции
   *   (админский обзор).
   * @returns виды станций без секретного материала.
   */
  async list(login?: string): Promise<StationView[]> {
    await this.ready
    const views = this.store.snapshot()
      .filter(record => login === undefined || record.login === login)
      .map(record => this.toView(record))
    return views.sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Вид одной станции без секретного материала: существует ли станция и кому
   * сопряжена — источник проверки принадлежности для потребителей RPC
   * (привязка сессии к станции исполнения).
   * @param stationId - идентификатор станции.
   * @returns вид станции или undefined, когда станция не сопряжена.
   */
  async get(stationId: StationId): Promise<StationView | undefined> {
    await this.ready
    const record = this.store.get(String(stationId))
    return record === undefined ? undefined : this.toView(record)
  }

  /**
   * Проверяет токен станции timing-safe сравнением хэша; точка
   * аутентификации и для auth-места вебсервера, и для приветствия сессии.
   * @param token - предъявленный токен.
   * @returns запись станции или undefined, когда токен не принят.
   */
  verifyStationToken(token: string): { stationId: StationId; rootPath: string; platform: StationPlatform } | undefined {
    if (typeof token !== 'string' || token.length === 0) return undefined
    const presented = createHash('sha256').update(token).digest()
    for (const record of this.store.snapshot()) {
      const stored = Buffer.from(record.tokenHash, 'hex')
      if (stored.length === presented.length && timingSafeEqual(stored, presented)) {
        return { stationId: record.stationId, rootPath: record.rootPath, platform: record.platform }
      }
    }
    return undefined
  }

  /**
   * Живой мост к станции для провайдеров швов fs/subprocess.
   * @param stationId - идентификатор станции.
   * @returns мост, когда станция на связи.
   * @throws StationsError `unknown-station` / `offline`.
   */
  bridge(stationId: StationId): StationBridge {
    const session = this.sessions.get(String(stationId))
    if (session !== undefined) return this.toBridge(session)
    const known = this.store.get(String(stationId))
    if (known === undefined) {
      throw new StationsError(`станция ${String(stationId)} не сопряжена`, 'unknown-station')
    }
    throw new StationsError(`станция «${known.name}» сейчас офлайн: дождитесь подключения коннектора`, 'offline')
  }

  /** Узкая грань моста поверх живой сессии: приветствие уже прошло. */
  private toBridge(session: StationServerSession): StationBridge {
    if (session.stationId === undefined || session.rootPath === undefined || session.platform === undefined) {
      throw new StationsError('сессия станции ещё не прошла приветствие', 'offline')
    }
    return {
      stationId: session.stationId,
      platform: session.platform,
      rootPath: session.rootPath,
      request: (op, payload, opts) => session.request(op, payload, opts),
      onEvent: handler => session.onEvent(handler),
    }
  }

  /**
   * Онлайн-ли станция прямо сейчас.
   * @param stationId - идентификатор станции.
   * @returns true, когда живое соединение коннектора открыто.
   */
  isOnline(stationId: StationId): boolean {
    return this.sessions.has(String(stationId))
  }

  /**
   * Запись реестра о станции без секретного материала — источник корня и
   * платформы для провайдеров швов: проверка путей на хосте обязана работать
   * и когда станция офлайн.
   * @param stationId - идентификатор станции.
   * @returns корень и платформа записи, или undefined для несопряжённой.
   */
  async describe(stationId: StationId): Promise<{ rootPath: string; platform: StationPlatform } | undefined> {
    await this.ready
    const record = this.store.get(String(stationId))
    if (record === undefined) return undefined
    return { rootPath: record.rootPath, platform: record.platform }
  }

  /** Подключает новый сокет: одна сессия на сокет, свежая заменяет прежнюю. */
  private attach(ws: WebSocket): void {
    const session = new StationServerSession(ws, this.sessionHost())
    ws.on('message', (data: Buffer) => {
      session.handleMessage(data.toString('utf8'))
    })
    ws.on('close', () => {
      session.handleClose()
    })
    ws.on('error', (error) => {
      this.ctx.logger.warn(`stations: ошибка транспорта станции: ${error instanceof Error ? error.message : String(error)}`)
      session.handleClose()
    })
  }

  /** Грань хоста, которую сессии дёргают; связывает их с сервисом. */
  private sessionHost() {
    return {
      completePairing: (code: string, stationName: string, rootPath: string, platform: StationPlatform) =>
        this.completePairing(code, stationName, rootPath, platform),
      verifyStationToken: (token: string) => this.verifyStationToken(token),
      markOnline: (stationId: StationId, session: StationServerSession) => {
        const previous = this.sessions.get(String(stationId))
        const wasOffline = previous === undefined
        // Замещаем до handleClose прежней сессии: её markOffline тогда видит
        // в карте живую замену и не гасит статус — событие офлайн при
        // замене соединения не поднимается.
        this.sessions.set(String(stationId), session)
        if (previous !== undefined && previous !== session) {
          // Свежее соединение выигрывает: прежнему сокету больше нечего
          // делать мостом — его ожидающие запросы отклонятся в handleClose.
          previous.handleClose()
        }
        if (wasOffline) this.ctx.emit('station/status', { stationId, online: true })
        void this.store.touch(String(stationId)).catch((error: unknown) => {
          this.ctx.logger.warn(`stations: не удалось обновить lastSeenAt: ${error instanceof Error ? error.message : String(error)}`)
        })
      },
      markOffline: (stationId: StationId, session: StationServerSession) => {
        // Закрывшаяся замещённая сессия не должна погасить живую замену.
        if (this.sessions.get(String(stationId)) === session) {
          this.sessions.delete(String(stationId))
          this.ctx.emit('station/status', { stationId, online: false })
        }
      },
      logError: (error: unknown) => {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      },
    }
  }

  private toView(record: StationRecord): StationView {
    return {
      stationId: String(record.stationId),
      login: record.login,
      name: record.name,
      rootPath: record.rootPath,
      platform: record.platform,
      online: this.sessions.has(String(record.stationId)),
      lastSeenAt: record.lastSeenAt,
      createdAt: record.createdAt,
    }
  }

  /** Лениво подметает протухшие коды: без таймеров в пассивном состоянии. */
  private sweepExpiredPairings(): void {
    const now = Date.now()
    for (const [code, pending] of this.pairings) {
      if (pending.expiresAt <= now) this.pairings.delete(code)
    }
  }
}

export default StationsService
