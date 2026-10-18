/**
 * notifier domain contract: выдача кода привязки Telegram и статус привязки
 * вызывающего веб-логина. Код адресуется логину из веб-личности (по образцу
 * station.beginPairing): сервис нотификаций хранит ожидающие коды в памяти,
 * а подтверждение приходит от провайдера —Transport-половина, мимо этого
 * домена. Статус читает документ биндингов: привязка или есть, или нет,
 * без деталей получателя.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** notifier domain unary methods (the map keys notifier.* of RpcMethodMap). */
export interface NotifierApi {
  /**
   * Выдать одноразовый код привязки для логина вызывающего веб-пользователя.
   * Код живёт в памяти с TTL и гасится первым использованием провайдером
   * (Telegram принимает его как `/start КОД`).
   */
  beginBinding(request: RpcRequest<{}>): Promise<RpcResponse<{ code: string }>>

  /** Привязан ли логин вызывающего к получателю уведомлений. */
  status(request: RpcRequest<{}>): Promise<RpcResponse<{ bound: boolean }>>
}
