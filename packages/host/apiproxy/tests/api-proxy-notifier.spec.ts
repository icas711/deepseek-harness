/**
 * Домен notifier.* над заглушкой сервиса нотификаций: гейт веб-личности
 * (не-веб-вызов и пассивное развёртывание отвечают notifier-unavailable),
 * выдача кода привязки своего логина и статус привязки по документу биндингов.
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
import { runWithWebRequestHeaders, type WebIdentity } from '../src/web-identity.ts'
import { createApiProxy } from '../src/api-proxy.ts'

/** Личности заглушки; cookie `login=<имя>` выбирает её. */
const IDENTITIES: Record<string, WebIdentity> = {
  user: { login: 'user', admin: false, root: '/work/user' },
}

/** Заглушка сервиса нотификаций: код фиксированный, биндинг настраивается. */
function stubNotifier(options: { beginBinding?: (login: string) => unknown; bound: string[] } = { bound: [] }): object {
  return {
    beginBinding: options.beginBinding ?? ((login: string) => ({ code: 'a1b2c3d4', login })),
    boundLogins: async () => options.bound,
  }
}

async function harness(options: { notifier?: object } = {}): Promise<{ api: ApiProxy }> {
  const ctx = new Context()
  if (options.notifier !== undefined) ctx.provide('notifier', options.notifier as never)
  ctx.provide('webAuth', {
    identityFromCookie: (cookie: string | undefined) => {
      const login = cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('login='))?.slice('login='.length)
      return login === undefined ? undefined : IDENTITIES[login]
    },
  } as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ApprovalService)
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
  return { api }
}

/** Один вызов notifier.* под заданной личностью (или без неё). */
async function call(
  api: ApiProxy,
  method: 'beginBinding' | 'status',
  login: string | undefined,
): Promise<RpcResponse<unknown>> {
  const face = (api.notifier[method]) as (request: RpcRequest<never>) => Promise<RpcResponse<unknown>>
  const request = { rpcId: RpcId('t'), payload: {} } as RpcRequest<never>
  return runWithWebRequestHeaders(
    login === undefined ? new Headers() : new Headers({ cookie: `login=${login}` }),
    () => face.call(api.notifier, request),
  )
}

/** Ошибка-ветка ответа. */
async function errorOf(promise: Promise<RpcResponse<unknown>>): Promise<{ code: string; message: string }> {
  const response = await promise
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('unreachable: the call should have failed')
  return response.result.error
}

describe('домен notifier.*', () => {
  it('не-веб-вызов и пассивное развёртывание отвечают notifier-unavailable', async () => {
    const passive = await harness()
    for (const login of [undefined, 'user']) {
      await expect(errorOf(call(passive.api, 'beginBinding', login))).resolves.toMatchObject({ code: 'notifier-unavailable' })
      await expect(errorOf(call(passive.api, 'status', login))).resolves.toMatchObject({ code: 'notifier-unavailable' })
    }
    // Сервис есть, но личности нет — тот же отказ.
    const anonymous = await harness({ notifier: stubNotifier() })
    await expect(errorOf(call(anonymous.api, 'beginBinding', undefined))).resolves.toMatchObject({ code: 'notifier-unavailable' })
    await expect(errorOf(call(anonymous.api, 'status', undefined))).resolves.toMatchObject({ code: 'notifier-unavailable' })
  })

  it('beginBinding выдаёт код для логина вызывающего; статус читает биндинги', async () => {
    const seen: string[] = []
    const notifier = stubNotifier({
      beginBinding: (login) => {
        seen.push(login)
        return { code: '77aa77bb' }
      },
      bound: ['user'],
    })
    const { api } = await harness({ notifier })
    const binding = await call(api, 'beginBinding', 'user')
    expect(binding.result).toEqual({ ok: true, value: { code: '77aa77bb' } })
    // Код адресуется логину веб-личности, а не произвольной строке запроса.
    expect(seen).toEqual(['user'])
    const bound = await call(api, 'status', 'user')
    expect(bound.result).toEqual({ ok: true, value: { bound: true } })
  })

  it('незакреплённый логин отвечает bound: false', async () => {
    const { api } = await harness({ notifier: stubNotifier({ bound: ['someone-else'] }) })
    const response = await call(api, 'status', 'user')
    expect(response.result).toEqual({ ok: true, value: { bound: false } })
  })

  it('отказ сервиса beginBinding сворачивается в notifier-unavailable с текстом сервиса', async () => {
    const failing = stubNotifier({
      beginBinding: () => {
        throw new Error('notifier: login must be 1-128 characters without whitespace')
      },
      bound: [],
    })
    const { api } = await harness({ notifier: failing })
    const error = await errorOf(call(api, 'beginBinding', 'user'))
    expect(error.code).toBe('notifier-unavailable')
    expect(error.message).toContain('1-128 characters')
  })
})
