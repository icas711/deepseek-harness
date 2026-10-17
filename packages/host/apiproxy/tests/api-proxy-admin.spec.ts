/**
 * The admin.* domain over a stubbed webAuth service: the role gate (a plain
 * user, an unauthenticated caller, and a passive deployment are all refused
 * with the typed `admin-forbidden`, an admin is admitted), the status probe
 * every caller may use, and the mapping of every WebAdminError code to its
 * typed wire error.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import type { RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import {
  runWithWebRequestHeaders, WebAdminError,
  type WebAuthService, type WebIdentity,
} from '../src/web-identity.ts'
import { createApiProxy } from '../src/api-proxy.ts'

/** The identities the stub store backs. */
const IDENTITIES: Record<string, WebIdentity> = {
  admin: { login: 'admin', admin: true, root: '/work/admin' },
  user: { login: 'user', admin: false, root: '/work/user' },
}

/** An in-memory double of the web-auth administration face. */
function stubService(): WebAuthService {
  return {
    identityFromCookie: (cookie) => {
      const login = cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('login='))?.slice('login='.length)
      return login === undefined ? undefined : IDENTITIES[login]
    },
    listUsers: () => [
      { login: 'admin', role: 'admin', createdAt: 100 },
      { login: 'user', role: 'user', createdAt: 200 },
    ],
    createUser: async (input) => {
      if (input.login === 'user') throw new WebAdminError('user-exists', 'уже существует')
    },
    deleteUser: async (login) => {
      if (login === 'ghost') throw new WebAdminError('user-not-found', 'не найден')
      if (login === 'admin') throw new WebAdminError('last-admin', 'последний администратор')
    },
    resetPassword: async (login) => {
      if (login === 'ghost') throw new WebAdminError('user-not-found', 'не найден')
    },
    setRole: async (login, role) => {
      if (login === 'ghost') throw new WebAdminError('user-not-found', 'не найден')
      if (role === 'user' && login === 'admin') throw new WebAdminError('last-admin', 'последний администратор')
    },
    listDevices: (login) => {
      if (login === 'ghost') throw new WebAdminError('user-not-found', 'не найден')
      return [{ sessionId: 'dev-1', issuedAt: 1, expiresAt: 99, lastSeenAt: 5 }]
    },
    revokeDevice: async (login, sessionId) => {
      if (login === 'ghost') throw new WebAdminError('user-not-found', 'не найден')
      if (sessionId === 'no-such') throw new WebAdminError('device-not-found', 'устройство не найдено')
    },
    revokeAllDevices: async (login) => {
      if (login === 'ghost') throw new WebAdminError('user-not-found', 'не найден')
      return 2
    },
  }
}

async function harness(): Promise<{ api: ApiProxy }> {
  const ctx = new Context()
  ctx.provide('webAuth', stubService())
  // The same host spine the other api-proxy specs mount: createApiProxy
  // wires the question/approval registries at construction.
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ApprovalService)
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
  return { api }
}

/** The admin method names the spec drives. */
type AdminMethod = 'status' | 'listUsers' | 'createUser' | 'deleteUser' | 'resetPassword' | 'setRole' | 'listDevices' | 'revokeDevice' | 'revokeAllDevices'

/** Serve one admin.* call under a named caller's headers (or none). */
async function call(
  api: ApiProxy, method: AdminMethod, login: string | undefined, payload: Record<string, unknown> = {},
): Promise<RpcResponse<unknown>> {
  const face = api.admin[method] as (request: RpcRequest<never>) => Promise<RpcResponse<unknown>>
  const request = { rpcId: RpcId('t'), payload } as RpcRequest<never>
  return runWithWebRequestHeaders(
    login === undefined ? new Headers() : new Headers({ cookie: `login=${login}` }),
    () => face.call(api.admin, request),
  )
}

/** The wire error the spec asserts on. */
type AdminWireError = { code: string; message: string; details: Record<string, unknown> }

/** The error branch of one admin call, asserted ok=false. */
async function errorOf(promise: Promise<RpcResponse<unknown>>): Promise<AdminWireError> {
  const response = await promise
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('unreachable: the call should have failed')
  return response.result.error
}

describe('admin.* role gate', () => {
  it('refuses a plain user, an unauthenticated caller, and a passive deployment with admin-forbidden', async () => {
    const { api } = await harness()
    for (const login of ['user', undefined]) {
      const error = await errorOf(call(api, 'listUsers', login))
      expect(error.code).toBe('admin-forbidden')
      expect(error.details).toEqual({})
    }
    // A passive deployment provides no webAuth service: the gate refuses the same way.
    const openCtx = new Context()
    await openCtx.plugin(SessionStore)
    await openCtx.plugin(SystemPrompt, { persona: '' })
    await openCtx.plugin(UserQuestionService)
    await openCtx.plugin(AgentRegistry)
    await openCtx.plugin(ApprovalService)
    const open = createApiProxy(openCtx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    expect((await errorOf(call(open, 'listUsers', 'admin'))).code).toBe('admin-forbidden')
  })

  it('answers status to every caller with their own flag', async () => {
    const { api } = await harness()
    const asAdmin = await call(api, 'status', 'admin')
    const asUser = await call(api, 'status', 'user')
    expect(asAdmin.result).toEqual({ ok: true, value: { admin: true } })
    expect(asUser.result).toEqual({ ok: true, value: { admin: false } })
  })

  it('admits an admin to every data method', async () => {
    const { api } = await harness()
    const listed = await call(api, 'listUsers', 'admin')
    expect(listed.result).toEqual({ ok: true, value: { users: [
      { login: 'admin', role: 'admin', createdAt: 100 },
      { login: 'user', role: 'user', createdAt: 200 },
    ] } })
    for (const [method, payload] of [
      ['createUser', { login: 'carol', password: 'parol-parol', role: 'user' }],
      ['setRole', { login: 'carol', role: 'admin' }],
      ['resetPassword', { login: 'carol', newPassword: 'drugoi-parol' }],
      ['listDevices', { login: 'user' }],
      ['revokeDevice', { login: 'user', sessionId: 'dev-1' }],
      ['revokeAllDevices', { login: 'user' }],
      ['deleteUser', { login: 'carol' }],
    ] as const) {
      const payloadRecord: Record<string, unknown> = payload
      const response = await call(api, method, 'admin', payloadRecord)
      expect(response.result.ok, `${method} должен пройти у админа`).toBe(true)
    }
    const devices = await call(api, 'listDevices', 'admin', { login: 'user' })
    expect(devices.result).toEqual({ ok: true, value: { devices: [{ sessionId: 'dev-1', issuedAt: 1, expiresAt: 99, lastSeenAt: 5 }] } })
    const revokedAll = await call(api, 'revokeAllDevices', 'admin', { login: 'user' })
    expect(revokedAll.result).toEqual({ ok: true, value: { revoked: 2 } })
  })
})

describe('admin.* typed rejections', () => {
  it('maps every WebAdminError code to its wire error with the named details', async () => {
    const { api } = await harness()
    expect(await errorOf(call(api, 'createUser', 'admin', { login: 'user', password: 'parol-parol', role: 'user' })))
      .toMatchObject({ code: 'admin-user-exists', details: { login: 'user' } })
    expect(await errorOf(call(api, 'deleteUser', 'admin', { login: 'ghost' })))
      .toMatchObject({ code: 'admin-user-not-found', details: { login: 'ghost' } })
    expect(await errorOf(call(api, 'deleteUser', 'admin', { login: 'admin' })))
      .toMatchObject({ code: 'admin-last-admin', details: { login: 'admin' } })
    expect(await errorOf(call(api, 'resetPassword', 'admin', { login: 'ghost', newPassword: 'parol-parol' })))
      .toMatchObject({ code: 'admin-user-not-found', details: { login: 'ghost' } })
    expect(await errorOf(call(api, 'setRole', 'admin', { login: 'ghost', role: 'admin' })))
      .toMatchObject({ code: 'admin-user-not-found', details: { login: 'ghost' } })
    expect(await errorOf(call(api, 'setRole', 'admin', { login: 'admin', role: 'user' })))
      .toMatchObject({ code: 'admin-last-admin', details: { login: 'admin' } })
    expect(await errorOf(call(api, 'listDevices', 'admin', { login: 'ghost' })))
      .toMatchObject({ code: 'admin-user-not-found', details: { login: 'ghost' } })
    expect(await errorOf(call(api, 'revokeAllDevices', 'admin', { login: 'ghost' })))
      .toMatchObject({ code: 'admin-user-not-found', details: { login: 'ghost' } })
    expect(await errorOf(call(api, 'revokeDevice', 'admin', { login: 'user', sessionId: 'no-such' })))
      .toMatchObject({ code: 'admin-device-not-found', details: { login: 'user', sessionId: 'no-such' } })
  })

  it('folds a non-WebAdminError service throw into internal', async () => {
    // The stub throws the recorded WebAdminError; drive the raw path instead:
    // a service whose createUser explodes with a plain Error.
    const ctx = new Context()
    ctx.provide('webAuth', {
      identityFromCookie: () => IDENTITIES.admin,
      listUsers: () => [],
      createUser: async () => { throw new Error('disk exploded') },
      deleteUser: async () => undefined,
      resetPassword: async () => undefined,
      setRole: async () => undefined,
      listDevices: () => [],
      revokeDevice: async () => undefined,
      revokeAllDevices: async () => 0,
    })
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ApprovalService)
    const open = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    const error = await errorOf(call(open, 'createUser', 'admin', { login: 'x', password: 'parol-parol', role: 'user' }))
    expect(error.code).toBe('internal')
    expect(error.message).toContain('disk exploded')
  })
})
