/**
 * Каркас проводного протокола моста станций: версия протокола, декодер
 * кадров с полной структурной проверкой (проводная граница), утилита
 * `assertNever` для закрытых юнионов и проверка изоляции путей, общая
 * для обеих сторон — хост проверяет перед отправкой, коннектор ещё раз
 * перед исполнением. Обе стороны — Node, поэтому node:path допустим.
 * @module @deepseek-ai/dsh-station-protocol
 */

import { posix, win32 } from 'node:path'
import type {
  StationEventFrame,
  StationEventName,
  StationFrame,
  StationOpErrorCode,
  StationOpName,
  StationOpPayloadMap,
  StationPlatform,
  StationRejectReason,
  StationRequestFrame,
  StationResponseFrame,
} from './types.ts'

export type {
  StationDirEntry,
  StationEntryType,
  StationEventFrame,
  StationEventName,
  StationEventPayloadMap,
  StationFrame,
  StationHello,
  StationHelloAuth,
  StationOpError,
  StationOpErrorCode,
  StationOpName,
  StationOpPayloadMap,
  StationOpValueMap,
  StationPairAuth,
  StationPlatform,
  StationReject,
  StationRejectReason,
  StationRequestFrame,
  StationResponseFrame,
  StationSpawnStdin,
  StationStatResult,
  StationTokenAuth,
  StationWelcome,
} from './types.ts'
export { StationId, StationRequestId } from './types.ts'

/**
 * Версия проводного протокола. Меняется только вместе с форматом кадров:
 * коннектор и хост разных версий обязаны вежливо разойтись через reject
 * `protocol-version`, а не упасть на разборе.
 */
export const STATION_PROTOCOL_VERSION = 1

/** Путь upgrade-маршрута станции на веб-сервере оркестратора. */
export const STATION_WS_PATH = '/station-ws'

/**
 * Алфавит одноразовых кодов сопряжения: без гласных и похожих пар, чтобы
 * код надёжно диктовался по телефону. Формат кода — часть протокола
 * сопряжения, а не настройка развёртывания.
 */
const PAIRING_ALPHABET = '23456789bcdghjkmnpqrstvwxz'

/** Длина одноразового кода сопряжения. */
export const PAIRING_CODE_LENGTH = 8

/**
 * Минтует одноразовый код сопряжения.
 * @param random - источник случайных байт; по умолчанию crypto.
 * @returns код из алфавита {@link PAIRING_ALPHABET} длиной {@link PAIRING_CODE_LENGTH}.
 */
export function mintPairingCode(random: (size: number) => Uint8Array): string {
  const bytes = random(PAIRING_CODE_LENGTH)
  let code = ''
  for (const byte of bytes) {
    code += PAIRING_ALPHABET.charAt(byte % PAIRING_ALPHABET.length)
  }
  return code
}

/** Ошибка декодирования кадра: нарушен формат проводной границы. */
export class StationProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StationProtocolError'
  }
}

/** Исчерпание закрытого юниона: ветка default обязана вести сюда. */
export function assertNever(value: never): never {
  throw new Error(`неожиданная ветка закрытого юниона: ${JSON.stringify(String(value))}`)
}

/**
 * Отказ операции, приехавший в кадре res; код стабилен для машрутизации
 * на вызывающей стороне (провайдеры переводят его в коды швов fs/subprocess).
 */
export class StationOpRemoteError extends Error {
  /** Стабильный код ошибки из протокола. */
  readonly code: StationOpErrorCode

  /**
   * Собирает отказ операции.
   * @param code - код ошибки из закрытого юниона протокола.
   * @param message - человекочитаемый текст на русском от станции.
   */
  constructor(code: StationOpErrorCode, message: string) {
    super(message)
    this.name = 'StationOpRemoteError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string') throw new StationProtocolError(`кадр: поле "${field}" должно быть строкой`)
  return value
}

function optionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new StationProtocolError(`кадр: поле "${field}" должно быть строкой`)
  return value
}

function requireNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new StationProtocolError(`кадр: поле "${field}" должно быть конечным числом`)
  }
  return value
}

function requireBoolean(record: Record<string, unknown>, field: string): boolean {
  const value = record[field]
  if (typeof value !== 'boolean') throw new StationProtocolError(`кадр: поле "${field}" должно быть булевым`)
  return value
}

function decodePlatform(value: unknown): StationPlatform {
  if (value !== 'win32' && value !== 'darwin' && value !== 'linux') {
    throw new StationProtocolError('hello: неизвестная платформа станции')
  }
  return value
}

function decodeHello(record: Record<string, unknown>): StationFrame {
  if (record.version !== STATION_PROTOCOL_VERSION) {
    throw new StationProtocolError(`hello: версия ${String(record.version)} не поддерживается`)
  }
  const auth = record.auth
  if (!isRecord(auth)) throw new StationProtocolError('hello: отсутствует блок auth')
  const mode = auth.mode
  if (mode === 'pair') {
    return {
      t: 'hello',
      version: STATION_PROTOCOL_VERSION,
      auth: {
        mode: 'pair',
        code: requireString(auth, 'code'),
        stationName: requireString(auth, 'stationName'),
        rootPath: requireString(auth, 'rootPath'),
        platform: decodePlatform(auth.platform),
      },
    }
  }
  if (mode === 'token') {
    return { t: 'hello', version: STATION_PROTOCOL_VERSION, auth: { mode: 'token', token: requireString(auth, 'token') } }
  }
  throw new StationProtocolError('hello: неизвестный способ аутентификации')
}

const REJECT_REASONS: readonly StationRejectReason[] = ['protocol-version', 'bad-code', 'bad-token', 'bad-request']

function decodeReject(record: Record<string, unknown>): StationFrame {
  const reason = record.reason
  if (typeof reason !== 'string' || !REJECT_REASONS.includes(reason as StationRejectReason)) {
    throw new StationProtocolError('reject: неизвестная причина отказа')
  }
  return { t: 'reject', reason: reason as StationRejectReason, message: requireString(record, 'message') }
}

const OP_NAMES: readonly StationOpName[] = [
  'fs/stat', 'fs/list', 'fs/read', 'fs/write', 'fs/mkdir', 'fs/unlink',
  'proc/resolve', 'proc/spawn', 'proc/write', 'proc/close-stdin', 'proc/kill', 'proc/list',
]

const EVENT_NAMES: readonly StationEventName[] = ['proc/stdout', 'proc/stderr', 'proc/exit']

function decodeRequestPayload(op: StationOpName, p: Record<string, unknown>): StationRequestFrame {
  switch (op) {
    case 'fs/stat': {
      const lstat = p.lstat
      if (lstat !== undefined && typeof lstat !== 'boolean') {
        throw new StationProtocolError('кадр: поле "lstat" должно быть булевым')
      }
      return { t: 'req', id: '', op, p: { path: requireString(p, 'path'), ...(lstat === undefined ? {} : { lstat }) } }
    }
    case 'fs/list':
    case 'fs/unlink':
      return { t: 'req', id: '', op, p: { path: requireString(p, 'path') } }
    case 'fs/read':
      return { t: 'req', id: '', op, p: { path: requireString(p, 'path'), maxBytes: requireNumber(p, 'maxBytes') } }
    case 'fs/write':
      return {
        t: 'req',
        id: '',
        op,
        p: { path: requireString(p, 'path'), data: requireString(p, 'data'), createOnly: requireBoolean(p, 'createOnly') },
      }
    case 'fs/mkdir':
      return { t: 'req', id: '', op, p: { path: requireString(p, 'path'), recursive: requireBoolean(p, 'recursive') } }
    case 'proc/resolve': {
      const pathEnv = optionalString(p, 'pathEnv')
      return {
        t: 'req',
        id: '',
        op,
        p: { command: requireString(p, 'command'), ...(pathEnv === undefined ? {} : { pathEnv }) },
      }
    }
    case 'proc/spawn': {
      if (!Array.isArray(p.argv) || p.argv.some(item => typeof item !== 'string')) {
        throw new StationProtocolError('proc/spawn: argv должен быть массивом строк')
      }
      const stdin = p.stdin
      let decodedStdin: StationOpPayloadMap['proc/spawn']['stdin']
      if (!isRecord(stdin)) throw new StationProtocolError('proc/spawn: отсутствует блок stdin')
      if (stdin.mode === 'ignore' || stdin.mode === 'pipe') {
        decodedStdin = { mode: stdin.mode }
      } else if (stdin.mode === 'data') {
        decodedStdin = { mode: 'data', data: requireString(stdin, 'data') }
      } else {
        throw new StationProtocolError('proc/spawn: неизвестный режим stdin')
      }
      const env = p.env
      if (env !== undefined && (!isRecord(env) || Object.values(env).some(item => typeof item !== 'string'))) {
        throw new StationProtocolError('proc/spawn: env должен быть словарём строк')
      }
      return {
        t: 'req',
        id: '',
        op,
        p: {
          id: requireString(p, 'id'),
          argv: p.argv as string[],
          cwd: requireString(p, 'cwd'),
          stdin: decodedStdin,
          stdoutInherit: requireBoolean(p, 'stdoutInherit'),
          stderrInherit: requireBoolean(p, 'stderrInherit'),
          ...(env === undefined ? {} : { env: env as Record<string, string> }),
        },
      }
    }
    case 'proc/write':
      return { t: 'req', id: '', op, p: { id: requireString(p, 'id'), data: requireString(p, 'data') } }
    case 'proc/close-stdin':
      return { t: 'req', id: '', op, p: { id: requireString(p, 'id') } }
    case 'proc/kill':
      return { t: 'req', id: '', op, p: { id: requireString(p, 'id'), force: requireBoolean(p, 'force') } }
    case 'proc/list':
      return { t: 'req', id: '', op, p: {} }
    default:
      return assertNever(op)
  }
}

function decodeEventPayload(event: StationEventName, p: Record<string, unknown>): StationEventFrame {
  switch (event) {
    case 'proc/stdout':
    case 'proc/stderr':
      return { t: 'evt', event, p: { id: requireString(p, 'id'), data: requireString(p, 'data') } }
    case 'proc/exit': {
      const exitCode = p.exitCode
      const signal = p.signal
      if (exitCode !== null && typeof exitCode !== 'number') {
        throw new StationProtocolError('proc/exit: exitCode должен быть числом или null')
      }
      if (signal !== null && typeof signal !== 'string') {
        throw new StationProtocolError('proc/exit: signal должен быть строкой или null')
      }
      return { t: 'evt', event, p: { id: requireString(p, 'id'), exitCode, signal } }
    }
    default:
      return assertNever(event)
  }
}

/**
 * Полностью проверяет один входящий кадр проводной границы. Поля,
 * не входящие в формат, отбрасываются; нарушение структуры — throw
 * {@link StationProtocolError}, отправитель такого кадра отключается.
 * @param raw - разобранный из JSON кадр.
 * @returns кадр с точным типом закрытого юниона.
 * @throws StationProtocolError при любом нарушении формата.
 */
export function decodeStationFrame(raw: unknown): StationFrame {
  if (!isRecord(raw)) throw new StationProtocolError('кадр должен быть объектом')
  const t = raw.t
  if (typeof t !== 'string') throw new StationProtocolError('кадр без дискриминанта t')
  switch (t) {
    case 'hello':
      return decodeHello(raw)
    case 'welcome': {
      const token = optionalString(raw, 'token')
      return {
        t: 'welcome',
        stationId: requireString(raw, 'stationId'),
        rootPath: requireString(raw, 'rootPath'),
        ...(token === undefined ? {} : { token }),
      }
    }
    case 'reject':
      return decodeReject(raw)
    case 'req': {
      const op = raw.op
      if (typeof op !== 'string' || !OP_NAMES.includes(op as StationOpName)) {
        throw new StationProtocolError(`req: неизвестная операция ${JSON.stringify(String(op))}`)
      }
      if (typeof raw.id !== 'string' || raw.id.length === 0) {
        throw new StationProtocolError('req: id корреляции обязателен')
      }
      const p = raw.p
      if (!isRecord(p)) throw new StationProtocolError('req: отсутствует блок p')
      const frame = decodeRequestPayload(op as StationOpName, p)
      return { ...frame, id: raw.id }
    }
    case 'res': {
      if (typeof raw.id !== 'string' || raw.id.length === 0) {
        throw new StationProtocolError('res: id корреляции обязателен')
      }
      if (raw.ok === true) return { t: 'res', id: raw.id, ok: true, value: raw.value } as StationResponseFrame
      if (raw.ok === false) {
        const error = raw.error
        if (!isRecord(error)) throw new StationProtocolError('res: отсутствует блок error')
        const code = error.code
        if (typeof code !== 'string') throw new StationProtocolError('res: код ошибки обязателен')
        return { t: 'res', id: raw.id, ok: false, error: { code: code as StationOpErrorCode, message: requireString(error, 'message') } }
      }
      throw new StationProtocolError('res: поле ok обязательно')
    }
    case 'evt': {
      const event = raw.event
      if (typeof event !== 'string' || !EVENT_NAMES.includes(event as StationEventName)) {
        throw new StationProtocolError(`evt: неизвестное событие ${JSON.stringify(String(event))}`)
      }
      const p = raw.p
      if (!isRecord(p)) throw new StationProtocolError('evt: отсутствует блок p')
      return decodeEventPayload(event as StationEventName, p)
    }
    default:
      throw new StationProtocolError(`кадр: неизвестный дискриминант ${JSON.stringify(t)}`)
  }
}

/**
 * Декодирует и проверяет один текстовый WSS-кадр.
 * @param text - сырое текстовое сообщение сокета.
 * @returns проверенный кадр.
 * @throws StationProtocolError, если это не JSON или формат нарушен.
 */
export function decodeStationText(text: string): StationFrame {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new StationProtocolError(`кадр не является JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return decodeStationFrame(raw)
}

/**
 * Проверяет изоляцию пути лексически по правилам платформы станции:
 * путь резолвится против корня и обязан остаться внутри него. Обе
 * стороны вызывают её — хост до отправки, коннектор перед исполнением.
 * @param root - корневая папка станции (абсолютный путь её платформы).
 * @param candidate - запрошенный путь (абсолютный или относительный).
 * @param platform - платформа станции, владелец правил разбора.
 * @returns абсолютный резолвнутый путь внутри корня.
 * @throws StationPathError при выходе за корень или недопустимом пути.
 */
export function resolveWithinRoot(root: string, candidate: string, platform: StationPlatform): string {
  const module = platform === 'win32' ? win32 : posix
  if (candidate.length === 0) throw new StationPathError('путь пуст')
  if (candidate.includes('\0')) throw new StationPathError('путь содержит NUL')
  // На Windows сравнение регистронезависимое: диск и сегменты могут
  // отличаться регистром, оставаясь одним и тем же путём.
  const samePath = (value: string): string => platform === 'win32' ? value.toLowerCase() : value
  const rootKey = samePath(root)
  const resolvedKey = samePath(module.resolve(root, candidate))
  const relative = module.relative(rootKey, resolvedKey)
  if (relative !== '' && (relative === '..' || relative.startsWith('../') || relative.startsWith('..\\') || module.isAbsolute(relative))) {
    throw new StationPathError(`путь выходит за корень станции: ${candidate}`)
  }
  return module.resolve(root, candidate)
}

/** Ошибка изоляции путей: запрос вышел за корень станции. */
export class StationPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StationPathError'
  }
}

/**
 * Канонизирует путь через realpath самого глубокого существующего предка
 * и заново проверяет изоляцию. Закрывает обход корня через символьную
 * ссылку, лежащую ВНУТРИ корня: лексическая проверка её пропустила бы.
 * @param root - корень станции.
 * @param candidate - запрошенный путь.
 * @param platform - платформа станции.
 * @param realpath - канал node:fs.realpath; параметр для тестов.
 * @returns канонический путь внутри канонического корня.
 * @throws StationPathError при выходе за корень после канонизации.
 */
export async function realpathWithinRoot(
  root: string,
  candidate: string,
  platform: StationPlatform,
  realpath: (path: string) => Promise<string>,
): Promise<string> {
  const module = platform === 'win32' ? win32 : posix
  const resolved = resolveWithinRoot(root, candidate, platform)
  const missing: string[] = []
  let current = resolved
  let canonicalAncestor: string | undefined
  while (true) {
    try {
      canonicalAncestor = await realpath(current)
      break
    } catch {
      const parent = module.dirname(current)
      if (parent === current) {
        // Дошли до несуществующего тома: канонизация невозможна —
        // отказ, а не тихий пропуск лексической проверки.
        throw new StationPathError(`не удалось канонизировать путь ${candidate}`)
      }
      missing.push(module.basename(current))
      current = parent
    }
  }
  const canonicalRoot = await realpath(root)
  // Цикл выше выходит только через успешный realpath предка.
  const canonical = module.join(canonicalAncestor, ...missing.reverse())
  const samePath = (value: string): string => platform === 'win32' ? value.toLowerCase() : value
  const relative = module.relative(samePath(canonicalRoot), samePath(canonical))
  if (relative !== '' && (relative === '..' || relative.startsWith('../') || relative.startsWith('..\\') || module.isAbsolute(relative))) {
    throw new StationPathError(`путь выходит за корень станции через символьную ссылку: ${candidate}`)
  }
  return canonical
}
