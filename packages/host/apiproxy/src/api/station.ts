/**
 * station domain contract: минимальный домен для будущего UI станций.
 * Сопряжение — действие пользователя веба: код выдаётся его логину и
 * привязывает станцию к нему; список показывает только свои станции.
 * Никакой вид не несёт секретного материала: токен станции существует
 * ровно один раз — в ответе completePairing коннектору.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Вид станции для wire и UI. */
export interface StationViewWire {
  /** Идентификатор станции из реестра. */
  stationId: string
  /** Логин владельца станции. */
  login: string
  /** Показательное имя станции. */
  name: string
  /** Корневая папка мира исполнения на станции. */
  rootPath: string
  /** Платформа станции — владелец правил разбора путей. */
  platform: string
  /** Есть ли прямо сейчас живое соединение коннектора. */
  online: boolean
  /** Последний выход на связь, эпоха в миллисекундах. */
  lastSeenAt: number
  /** Момент сопряжения, эпоха в миллисекундах. */
  createdAt: number
}

/** station domain unary methods (the map keys station.* of RpcMethodMap). */
export interface StationApi {
  /** Список станций вызывающего пользователя, упорядоченный по имени. */
  list(request: RpcRequest<{}>): Promise<RpcResponse<{ stations: StationViewWire[] }>>

  /**
   * Выдать одноразовый код сопряжения для логина вызывающего. Код живёт
   * в памяти с TTL и гасится первым использованием коннектором.
   */
  beginPairing(request: RpcRequest<{}>): Promise<RpcResponse<{ code: string; wssPath: string }>>
}
