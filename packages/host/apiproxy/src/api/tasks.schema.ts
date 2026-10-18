/**
 * tasks domain zod schemas (имена из ключей карты:
 * tasksListRequestSchema / tasksResumeRequestSchema / …).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { TaskViewWire } from './tasks.ts'

/** Статус задачи на wire (зеркало TaskStatus супервизора). */
export const taskStatusSchema: z.ZodType<Wire<TaskViewWire['status']>> = z.union([
  z.literal('running'),
  z.literal('paused'),
  z.literal('interrupted'),
  z.literal('waiting-station'),
  z.literal('completed'),
  z.literal('failed'),
])

/** Строка списка задач tasks.list. */
export const taskViewWireSchema = z.object({
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  title: z.string(),
  status: taskStatusSchema,
  updatedAt: z.number(),
  stationId: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<TaskViewWire>>

/** tasks.list request payload (empty). */
export const tasksListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'tasks.list'>>>

/** tasks.list response value. */
export const tasksListValueSchema = z.object({
  tasks: z.array(taskViewWireSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'tasks.list'>>>

/** tasks.resume request payload. */
export const tasksResumeRequestSchema = z.object({
  taskId: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'tasks.resume'>>>

/** tasks.resume response value. */
export const tasksResumeValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'tasks.resume'>>>
