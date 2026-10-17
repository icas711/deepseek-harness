/**
 * Notifier value types: the notification request, the pairing challenge, and
 * the durable binding record.
 * @module @deepseek-ai/dsh-notifier/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Opaque destination id a provider delivers to; the Telegram provider uses the chat id. */
export type ChatId = Branded<'ChatId'>

/** One-time pairing code the user presents to the provider's transport. */
export type BindingCode = Branded<'BindingCode'>

/** What happened to the work; providers own the human wording. */
export type NotificationKind =
  /** The task waits for a human decision (parked or otherwise blocked). */
  | 'paused'
  /** The previous process died on the task (hard crash). */
  | 'interrupted'
  /** The owner reported success. */
  | 'completed'
  /** The owner reported failure. */
  | 'failed'

/** One login-addressed notification. */
export interface NotificationRequest {
  /** The bound user the notification is addressed to. */
  readonly login: string
  /** What happened; providers own the human wording. */
  readonly kind: NotificationKind
  /** Human-readable work label. */
  readonly title: string
  /** The session whose work raised the notification. */
  readonly sessionId: SessionId
}

/** Outcome of one send attempt. */
export type SendResult =
  /** Delivered to the login's bound destination. */
  | 'sent'
  /** The login has no binding; nothing was delivered. */
  | 'unbound'

/** A confirmed login-to-destination binding. */
export interface BindingRecord {
  /** The user the notifications are addressed to. */
  readonly login: string
  /** Provider-owned destination id. */
  readonly chatId: ChatId
  /** Epoch milliseconds of when the binding was confirmed. */
  readonly boundAt: number
}

/** What beginBinding hands back for the user to present to the provider. */
export interface BindingChallenge {
  /** One-time code, valid for the configured lifetime. */
  readonly code: BindingCode
}
