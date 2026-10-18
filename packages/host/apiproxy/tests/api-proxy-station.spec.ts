/**
 * Домен station.* над заглушкой сервиса станций: гейт веб-личности
 * (не-веб-вызов и пассивное развёртывание отвечают stations-unavailable),
 * скоуп списка (пользователь видит свои, админ — все) и выдача кода
 * сопряжения с эхом пути WSS-маршрута.
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
import { StationsError } from '@deepseek-ai/dsh-stations'
import type { StationView } from '@deepseek-ai/dsh-stations'

/** Личности заглушки; cookie `login=<имя>` выбирает её. */
const IDENTITIES: Record<string, WebIdentity> = {
  admin: { login: 'admin', admin: true, root: '/work/admin' },
  user: { login: 'user', admin: false, root: '/work/user' },
}

/** Записи, которые отдаёт заглушка: две станции user, одна admin. */
const RECORDS: StationView[] = [
  { stationId: 'stn-u1', login: 'user', name: 'ноутбук', rootPath: '/w/u1', platform: 'linux', online: true, lastSeenAt: 20, createdAt: 10 },
  { stationId: 'stn-u2', login: 'user', name: 'нетбук', rootPath: '/w/u2', platform: 'win32', online: false, lastSeenAt: 30, createdAt: 11 },
  { stationId: 'stn-a1', login: 'admin', name: 'админская', rootPath: '/w/a1', platform: 'darwin', online: false, lastSeenAt: 40, createdAt: 12 },
]

/** Заглушка сервиса станций с настраиваемым поведением beginPairing. */
function stubStations(overrides: { beginPairing?: () => never } = {}): object {
  return {
    list: (login?: string) => RECORDS.filter(record => login === undefined || record.login === login),
    beginPairing: overrides.beginPairing ?? ((_login: string) => ({ code: 'ABCD2345', wssPath: '/station-ws' })),
  }
}

async function harness(options: { stations?: object } = {}): Promise<{ api: ApiProxy }> {
  const ctx = new Context()
  if (options.stations !== undefined) ctx.provide('stations', options.stations as never)
  // Личность для гейта: identityFromCookie читает cookie login=<имя>.
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

/** Один вызов station.* под заданной личностью (или без неё). */
async function call(
  api: ApiProxy,
  method: 'list' | 'beginPairing',
  login: string | undefined,
): Promise<RpcResponse<unknown>> {
  const face = (api.stations[method]) as (request: RpcRequest<never>) => Promise<RpcResponse<unknown>>
  const request = { rpcId: RpcId('t'), payload: {} } as RpcRequest<never>
  return runWithWebRequestHeaders(
    login === undefined ? new Headers() : new Headers({ cookie: `login=${login}` }),
    () => face.call(api.stations, request),
  )
}

/** Ошибка-ветка ответа, assertion ok=false. */
async function errorOf(promise: Promise<RpcResponse<unknown>>): Promise<{ code: string; message: string }> {
  const response = await promise
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('unreachable: the call should have failed')
  return response.result.error
}

describe('домен station.*', () => {
  it('не-веб-вызов и пассивное развёртывание отвечают stations-unavailable', async () => {
    const passive = await harness()
    for (const login of [undefined, 'user']) {
      await expect(errorOf(call(passive.api, 'list', login))).resolves.toMatchObject({ code: 'stations-unavailable' })
      await expect(errorOf(call(passive.api, 'beginPairing', login))).resolves.toMatchObject({ code: 'stations-unavailable' })
    }
    // Сервис есть, но личности нет — тот же отказ.
    const anonymous = await harness({ stations: stubStations() })
    await expect(errorOf(call(anonymous.api, 'beginPairing', undefined))).resolves.toMatchObject({ code: 'stations-unavailable' })
  })

  it('пользователь видит свои станции; админ — все; pair выдаёт код своего логина', async () => {
    const { api } = await harness({ stations: stubStations() })
    const own = await call(api, 'list', 'user')
    expect(own.result).toEqual({ ok: true, value: { stations: [RECORDS[0], RECORDS[1]] } })
    const all = await call(api, 'list', 'admin')
    expect(all.result).toEqual({ ok: true, value: { stations: RECORDS } })
    const pairing = await call(api, 'beginPairing', 'user')
    expect(pairing.result).toEqual({ ok: true, value: { code: 'ABCD2345', wssPath: '/station-ws' } })
  })

  it('отказ сервиса pair сворачивается в stations-unavailable с текстом сервиса', async () => {
    const failing = stubStations({
      beginPairing: () => {
        throw new StationsError('логин сопряжения обязателен', 'bad-input')
      },
    })
    const { api } = await harness({ stations: failing })
    const error = await errorOf(call(api, 'beginPairing', 'user'))
    expect(error.code).toBe('stations-unavailable')
    expect(error.message).toContain('логин сопряжения')
  })
})
