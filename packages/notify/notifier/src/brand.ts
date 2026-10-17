/**
 * Branding constructors for the notifier's opaque cross-boundary ids.
 * @module @deepseek-ai/dsh-notifier/brand
 */

import type { BindingCode, ChatId } from './types.ts'

/** Brand a raw string as a {@link ChatId}.
 * @param value - the raw destination id string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function ChatId(value: string): ChatId {
  return value as ChatId
}

/** Brand a raw string as a {@link BindingCode}.
 * @param value - the raw code string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function BindingCode(value: string): BindingCode {
  return value as BindingCode
}
