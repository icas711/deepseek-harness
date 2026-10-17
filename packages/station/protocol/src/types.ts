/**
 * Словарь проводного протокола моста станций: закрытые юнионы кадров
 * (дискриминант `t`), операций (`op`) и событий (`event`), типизированные
 * полезные нагрузки запрос/ответ и коды ошибок операций. Только типы —
 * рантайм-кодек и проверка путей живут в корне пакета.
 * @module @deepseek-ai/dsh-station-protocol/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Идентификатор станции, выданный оркестратором при сопряжении. */
export type StationId = Branded<'StationId'>

/**
 * Брендрует строку как {@link StationId}. Минтует только хост при
 * сопряжении; потребители получают идентификатор из реестра.
 * @param value - сырая строка идентификатора.
 * @returns та же строка, брендированная (компиляторный каст).
 */
export function StationId(value: string): StationId {
  return value as StationId
}

/**
 * Идентификатор корреляции запрос/ответ. Минтует инициатор запроса
 * (оркестратор), ответ эхом возвращает его же — новый не минтуется.
 */
export type StationRequestId = Branded<'StationRequestId'>

/**
 * Брендрует строку как {@link StationRequestId}.
 * @param value - сырая строка идентификатора (UUID на хосте).
 * @returns та же строка, брендированная (компиляторный каст).
 */
export function StationRequestId(value: string): StationRequestId {
  return value as StationRequestId
}

/** Платформа станции; определяет правила разбора путей на обеих сторонах. */
export type StationPlatform = 'win32' | 'darwin' | 'linux'

// ---- Приветствие и сопряжение ---------------------------------------------

/** Аутентификация сопряжением: одноразовый код из beginPairing. */
export interface StationPairAuth {
  mode: 'pair'
  /** Одноразовый код сопряжения с TTL. */
  code: string
  /** Показательное имя станции, выбранное пользователем. */
  stationName: string
  /** Корневая папка на станции: единственный мир исполнения моста. */
  rootPath: string
  /** Платформа станции — владелец правил разбора путей. */
  platform: StationPlatform
}

/** Аутентификация токеном станции, выданным при сопряжении. */
export interface StationTokenAuth {
  mode: 'token'
  /** Секретный токен станции; хост хранит только его хэш. */
  token: string
}

/** Один из двух способов представиться хосту; закрывается в hello. */
export type StationHelloAuth = StationPairAuth | StationTokenAuth

/** Первый кадр соединения: коннектор → хост, ровно один на соединение. */
export interface StationHello {
  t: 'hello'
  /** Версия протокола отправителя; несовпадение с хостовой = reject. */
  version: number
  auth: StationHelloAuth
}

/** Подтверждение привязки: хост → коннектор после успешного hello. */
export interface StationWelcome {
  t: 'welcome'
  /** Брендированный идентификатор станции из реестра. */
  stationId: string
  /** Корень, под которым хост будет предлагать пути (эхо сопряжения). */
  rootPath: string
  /**
   * Токен станции; едет коннектору ровно один раз — в ответе на
   * сопряжение. В welcome после проверки токена поле отсутствует.
   */
  token?: string
}

/** Отказ в привязке: хост → коннектор, затем соединение закрывается. */
export interface StationReject {
  t: 'reject'
  reason: 'protocol-version' | 'bad-code' | 'bad-token' | 'bad-request'
  /** Человекочитаемая причина на русском для лога коннектора. */
  message: string
}

// ---- Операции --------------------------------------------------------------

/** Тип записи каталога на станции; `symlink` — только ответ lstat-режима. */
export type StationEntryType = 'file' | 'directory' | 'symlink' | 'other'

/** Ответ fs/stat: отсутствие цели — валидный исход, а не ошибка. */
export type StationStatResult =
  | { exists: false }
  | { exists: true; type: StationEntryType; size?: number; version: string }

/** Одна запись fs/list. */
export interface StationDirEntry {
  name: string
  type: StationEntryType
  /** Размер регулярного файла, когда станция смогла его узнать. */
  size?: number
}

/** stdin запускаемого процесса: пакетные данные, канал или ничего. */
export type StationSpawnStdin =
  | { mode: 'ignore' }
  | { mode: 'pipe' }
  | { mode: 'data'; data: string }

/** Полезные нагрузки операций по имени операции. */
export interface StationOpPayloadMap {
  'fs/stat': { path: string; lstat?: boolean }
  'fs/list': { path: string }
  'fs/read': { path: string; maxBytes: number }
  'fs/write': { path: string; data: string; createOnly: boolean }
  'fs/mkdir': { path: string; recursive: boolean }
  'fs/unlink': { path: string }
  'proc/resolve': { command: string; pathEnv?: string }
  'proc/spawn': {
    /** Идентификатор процесса в рамках моста; минтует хост. */
    id: string
    argv: readonly string[]
    /** Рабочий каталог внутри корня станции. */
    cwd: string
    stdin: StationSpawnStdin
    /** true = поток уходит в консоль станции, событий по нему не будет. */
    stdoutInherit: boolean
    stderrInherit: boolean
    /** Явное окружение ребёнка поверх вычищенной базы коннектора. */
    env?: Record<string, string>
  }
  'proc/write': { id: string; data: string }
  'proc/close-stdin': { id: string }
  'proc/kill': { id: string; force: boolean }
  'proc/list': Record<string, never>
}

/** Результаты операций по имени операции. */
export interface StationOpValueMap {
  'fs/stat': StationStatResult
  'fs/list': { entries: StationDirEntry[] }
  'fs/read': { data: string }
  'fs/write': { version: string }
  'fs/mkdir': Record<string, never>
  'fs/unlink': Record<string, never>
  'proc/resolve': { executable: string }
  'proc/spawn': { pid: number }
  'proc/write': Record<string, never>
  'proc/close-stdin': Record<string, never>
  'proc/kill': Record<string, never>
  'proc/list': { processes: { id: string; pid: number; argv: string[] }[] }
}

/** Имена всех операций моста; ключи — закрытый юнион. */
export type StationOpName = keyof StationOpPayloadMap & keyof StationOpValueMap

/**
 * Коды ошибок операций. Стабильны для машрутизации на хосте: провайдеры
 * переводят их в коды швов fs/subprocess, не разбирая тексты.
 */
export type StationOpErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'denied'
  | 'too-large'
  | 'io'
  | 'unsupported'
  | 'unknown-process'

/** Ошибка операции на станции; текст на русском для диагностики. */
export interface StationOpError {
  code: StationOpErrorCode
  message: string
}

// ---- Кадры -----------------------------------------------------------------

/** Кадр-запрос хост → коннектор; ответ эхом возвращает id. */
export type StationRequestFrame = {
  [K in StationOpName]: {
    t: 'req'
    id: string
    op: K
    p: StationOpPayloadMap[K]
  }
}[StationOpName]

/** Кадр-ответ коннектор → хост. */
export type StationResponseFrame =
  | {
    t: 'res'
    id: string
    ok: true
    value: StationOpValueMap[StationRequestFrame['op']]
  }
  | { t: 'res'; id: string; ok: false; error: StationOpError }

/** Полезные нагрузки событий по имени события. */
export interface StationEventPayloadMap {
  'proc/stdout': { id: string; data: string }
  'proc/stderr': { id: string; data: string }
  'proc/exit': { id: string; exitCode: number | null; signal: string | null }
}

/** Имена событий коннектор → хост; ключи — закрытый юнион. */
export type StationEventName = keyof StationEventPayloadMap

/** Кадр-событие коннектор → хост; ответа не требует. */
export type StationEventFrame = {
  [K in StationEventName]: {
    t: 'evt'
    event: K
    p: StationEventPayloadMap[K]
  }
}[StationEventName]

/** Закрытый юнион всех кадров протокола; сужается по `t`. */
export type StationFrame =
  | StationHello
  | StationWelcome
  | StationReject
  | StationRequestFrame
  | StationResponseFrame
  | StationEventFrame
