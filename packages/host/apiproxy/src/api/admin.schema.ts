/**
 * admin domain zod schemas (names derived from map keys:
 * adminStatusRequestSchema / adminListUsersValueSchema / …). The login
 * pattern mirrors the web-auth login charset (logins double as cabinet
 * directory names); the password minimum is the wire face of the same rule
 * the service enforces.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { AdminDeviceView, AdminRole, AdminUserView } from './admin.ts'

/** The web-auth login charset (the store and the cabinet directories share it). */
export const adminLoginSchema = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)

/** Minimum password length the service accepts for created and reset passwords. */
export const ADMIN_PASSWORD_MIN = 8

/** Password of a created or reset account: bounded, never length-only spaces. */
export const adminPasswordSchema = z.string().min(ADMIN_PASSWORD_MIN).max(256)

/** AdminRole entry of the domain payloads. */
export const adminRoleSchema: z.ZodType<Wire<AdminRole>> = z.union([z.literal('admin'), z.literal('user')])

/** AdminUserView entry of admin.listUsers. */
export const adminUserViewSchema = z.object({
  login: adminLoginSchema,
  role: adminRoleSchema,
  createdAt: z.number(),
}) satisfies z.ZodType<Wire<AdminUserView>>

/** AdminDeviceView entry of admin.listDevices. */
export const adminDeviceViewSchema = z.object({
  sessionId: z.string(),
  issuedAt: z.number(),
  expiresAt: z.number(),
  lastSeenAt: z.number(),
}) satisfies z.ZodType<Wire<AdminDeviceView>>

/** admin.status request payload (empty). */
export const adminStatusRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'admin.status'>>>

/** admin.status response value. */
export const adminStatusValueSchema = z.object({
  admin: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'admin.status'>>>

/** admin.listUsers request payload (empty). */
export const adminListUsersRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'admin.listUsers'>>>

/** admin.listUsers response value. */
export const adminListUsersValueSchema = z.object({
  users: z.array(adminUserViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'admin.listUsers'>>>

/** admin.createUser request payload. */
export const adminCreateUserRequestSchema = z.object({
  login: adminLoginSchema,
  password: adminPasswordSchema,
  role: adminRoleSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'admin.createUser'>>>

/** admin.createUser response value. */
export const adminCreateUserValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'admin.createUser'>>>

/** admin.deleteUser request payload. */
export const adminDeleteUserRequestSchema = z.object({
  login: adminLoginSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'admin.deleteUser'>>>

/** admin.deleteUser response value. */
export const adminDeleteUserValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'admin.deleteUser'>>>

/** admin.resetPassword request payload. */
export const adminResetPasswordRequestSchema = z.object({
  login: adminLoginSchema,
  newPassword: adminPasswordSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'admin.resetPassword'>>>

/** admin.resetPassword response value. */
export const adminResetPasswordValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'admin.resetPassword'>>>

/** admin.setRole request payload. */
export const adminSetRoleRequestSchema = z.object({
  login: adminLoginSchema,
  role: adminRoleSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'admin.setRole'>>>

/** admin.setRole response value. */
export const adminSetRoleValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'admin.setRole'>>>

/** admin.listDevices request payload. */
export const adminListDevicesRequestSchema = z.object({
  login: adminLoginSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'admin.listDevices'>>>

/** admin.listDevices response value. */
export const adminListDevicesValueSchema = z.object({
  devices: z.array(adminDeviceViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'admin.listDevices'>>>

/** admin.revokeDevice request payload. */
export const adminRevokeDeviceRequestSchema = z.object({
  login: adminLoginSchema,
  sessionId: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'admin.revokeDevice'>>>

/** admin.revokeDevice response value. */
export const adminRevokeDeviceValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'admin.revokeDevice'>>>

/** admin.revokeAllDevices request payload. */
export const adminRevokeAllDevicesRequestSchema = z.object({
  login: adminLoginSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'admin.revokeAllDevices'>>>

/** admin.revokeAllDevices response value. */
export const adminRevokeAllDevicesValueSchema = z.object({
  revoked: z.number().int().min(0),
}) satisfies z.ZodType<Wire<ResponseValue<'admin.revokeAllDevices'>>>
