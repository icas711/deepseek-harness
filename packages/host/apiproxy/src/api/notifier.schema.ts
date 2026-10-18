/**
 * notifier domain zod schemas (имена из ключей карты:
 * notifierBeginBindingRequestSchema / notifierStatusValueSchema / …).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** notifier.beginBinding request payload (empty). */
export const notifierBeginBindingRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'notifier.beginBinding'>>>

/** notifier.beginBinding response value. */
export const notifierBeginBindingValueSchema = z.object({
  code: z.string().min(1),
}) satisfies z.ZodType<Wire<ResponseValue<'notifier.beginBinding'>>>

/** notifier.status request payload (empty). */
export const notifierStatusRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'notifier.status'>>>

/** notifier.status response value. */
export const notifierStatusValueSchema = z.object({
  bound: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'notifier.status'>>>
