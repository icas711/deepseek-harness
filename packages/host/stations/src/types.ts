/**
 * Словарь хост-стороны моста станций: бренды идентификаторов (минтуются в
 * корне пакета), записи реестра, виды сопряжения и типизированная ошибка
 * сервиса. Только типы — рантайм-код в registry.ts и index.ts.
 * @module @deepseek-ai/dsh-stations/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { StationId, StationPlatform } from '@deepseek-ai/dsh-station-protocol'

export type { StationId, StationPlatform }

/** Запись реестра об одной сопряжённой станции. */
export interface StationRecord {
  /** Идентификатор станции, минтует хост при сопряжении. */
  stationId: StationId
  /** Логин веб-пользователя, сопрягшего станцию. */
  login: string
  /** Показательное имя станции. */
  name: string
  /** Корневая папка на станции: единственный мир исполнения моста. */
  rootPath: string
  /** Платформа станции — владелец правил разбора путей. */
  platform: StationPlatform
  /** sha256 токена станции; сам токен хост не хранит никогда. */
  tokenHash: string
  /** Момент сопряжения, эпоха в миллисекундах. */
  createdAt: number
  /** Последний раз станция была на связи (открыто соединение), эпоха. */
  lastSeenAt: number
}

/** Вид станции для wire и UI: без секретного материала. */
export interface StationView {
  stationId: string
  login: string
  name: string
  rootPath: string
  platform: StationPlatform
  /** Есть ли прямо сейчас живое соединение коннектора. */
  online: boolean
  lastSeenAt: number
  createdAt: number
}

/** Ожидание сопряжения в памяти: одноразовый код с TTL. */
export interface PendingPairing {
  /** Логин, который запросил код; станция привязывается к нему. */
  login: string
  /** Момент, когда код протухает. */
  expiresAt: number
}

/** Типизированная ошибка сервиса станций. */
export class StationsError extends Error {
  /** Стабильный код отказа для машрутизации на вызывающей стороне. */
  readonly code: StationsErrorCode

  constructor(message: string, code: StationsErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StationsError'
    this.code = code
  }
}

/** Коды отказов сервиса станций. */
export type StationsErrorCode =
  | 'bad-code'
  | 'bad-input'
  | 'offline'
  | 'unknown-station'
