/**
 * station domain zod schemas (имена из ключей карты:
 * stationListRequestSchema / stationBeginPairingValueSchema / …).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** station.list request payload (empty). */
export const stationListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'station.list'>>>

/** station.list response value. */
export const stationListValueSchema = z.object({
  stations: z.array(z.object({
    stationId: z.string().min(1),
    login: z.string().min(1),
    name: z.string().min(1),
    rootPath: z.string().min(1),
    platform: z.union([z.literal('win32'), z.literal('darwin'), z.literal('linux')]),
    online: z.boolean(),
    lastSeenAt: z.number(),
    createdAt: z.number(),
  })),
}) satisfies z.ZodType<Wire<ResponseValue<'station.list'>>>

/** station.beginPairing request payload (empty). */
export const stationBeginPairingRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'station.beginPairing'>>>

/** station.beginPairing response value. */
export const stationBeginPairingValueSchema = z.object({
  code: z.string().min(1),
  wssPath: z.string().min(1),
}) satisfies z.ZodType<Wire<ResponseValue<'station.beginPairing'>>>
