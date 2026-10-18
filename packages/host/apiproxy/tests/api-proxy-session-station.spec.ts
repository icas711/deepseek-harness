/**
 * session.create with executionTarget: the gateway validates the station at
 * the wire boundary (registered, owned by the calling login, web identity and
 * bridge present) and the agent's setup mounts THAT station's fs/subprocess
 * world on private isolate labels inside the agent scope.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type AgentFactory } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { StationFileSystem } from '@deepseek-ai/dsh-fs-station'
import { StationId } from '@deepseek-ai/dsh-station-protocol'
import { StationSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-station'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { RpcId, type RpcRequest, type RpcResponse } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { runWithWebRequestHeaders, type WebIdentity } from '../src/web-identity.ts'

let nextRpc = 0
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`station-${String(nextRpc++)}`), payload }
}

/** The web identity the cookie names; no cookie means a non-web caller. */
const IDENTITIES: Record<string, WebIdentity> = {
  anna: { login: 'anna', admin: false, root: '/work/anna' },
  bob: { login: 'bob', admin: false, root: '/work/bob' },
  admin: { login: 'admin', admin: true, root: '/work/admin' },
}

/** Registry double: two paired stations, one per login. */
const STATIONS = {
  get: async (stationId: string) => {
    if (stationId === 'stn-anna') {
      return { stationId, login: 'anna', name: 'ноутбук', rootPath: '/w/anna', platform: 'linux', online: true, lastSeenAt: 1, createdAt: 1 }
    }
    if (stationId === 'stn-bob') {
      return { stationId, login: 'bob', name: 'нетбук', rootPath: '/w/bob', platform: 'win32', online: false, lastSeenAt: 2, createdAt: 2 }
    }
    return undefined
  },
}

/** The runtime service store, read for the mounted provider impls. */
interface StoreImpl { name: string; value: unknown }

function mountedServices(ctx: Context): StoreImpl[] {
  const store = (ctx as unknown as { reflect: { store: Record<symbol, StoreImpl | undefined> } }).reflect.store
  return Object.getOwnPropertySymbols(store)
    .map(symbol => store[symbol])
    .filter((impl): impl is StoreImpl => impl !== undefined && (impl.name === 'fs' || impl.name === 'subprocess'))
}

async function harness(): Promise<{ api: unknown; ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('stations', STATIONS as never)
  ctx.provide('webAuth', {
    identityFromCookie: (cookie: string | undefined) => {
      const login = cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('login='))?.slice('login='.length)
      return login === undefined ? undefined : IDENTITIES[login]
    },
  } as never)
  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session: Session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
      const agentCtx = ctx.extend({ agent })
      ;(agent as { ctx?: Context }).ctx = agentCtx
      await options.setup?.(agentCtx)
      const unregister = ctx.agents.register(agent)
      return { agent, dispose: () => { unregister(); return Promise.resolve() } }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: '/work/anna',
  })
  return { api, ctx }
}

/** One session.create under the given web identity (undefined = non-web caller). */
async function create(
  api: unknown,
  payload: Record<string, unknown>,
  login?: string,
): Promise<RpcResponse<unknown>> {
  const service = (api as { sessions: { create: (request: RpcRequest<never>) => Promise<RpcResponse<unknown>> } }).sessions
  const face = service.create
  return runWithWebRequestHeaders(
    login === undefined ? new Headers() : new Headers({ cookie: `login=${login}` }),
    () => face.call(service, request(payload) as RpcRequest<never>),
  )
}

function errorOf(response: RpcResponse<unknown>): { code: string; message: string } {
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('unreachable: the call should have failed')
  return response.result.error
}

describe('session.create with executionTarget', () => {
  it('mounts the named station fs/subprocess world inside the agent scope', async () => {
    const { api, ctx } = await harness()
    const response = await create(api, {
      sessionId: SessionId('s1'),
      executionTarget: { stationId: 'stn-anna' },
    }, 'anna')
    expect(response.result).toMatchObject({ ok: true, value: { sessionId: 's1' } })
    const mounted = mountedServices(ctx)
    expect(mounted).toHaveLength(2)
    const fs = mounted.find(impl => impl.name === 'fs')
    const subprocess = mounted.find(impl => impl.name === 'subprocess')
    expect(fs?.value).toBeInstanceOf(StationFileSystem)
    expect(subprocess?.value).toBeInstanceOf(StationSubprocessRuntime)
    // Private labels: the root scope resolves neither provider, so the host
    // composition keeps its own execution world.
    expect(ctx.get('fs')).toBeUndefined()
    expect(ctx.get('subprocess')).toBeUndefined()
  })

  it('mounts no world without executionTarget', async () => {
    const { api, ctx } = await harness()
    await create(api, { sessionId: SessionId('s2') }, 'anna')
    expect(mountedServices(ctx)).toHaveLength(0)
  })

  it('rejects an unknown station with station-not-found', async () => {
    const { api } = await harness()
    const error = errorOf(await create(api, {
      sessionId: SessionId('s3'),
      executionTarget: { stationId: StationId('stn-none') },
    }, 'anna'))
    expect(error.code).toBe('station-not-found')
    expect(error.message).toContain('stn-none')
  })

  it('rejects a foreign station with station-forbidden, admin included', async () => {
    const { api } = await harness()
    const foreign = errorOf(await create(api, {
      sessionId: SessionId('s4'),
      executionTarget: { stationId: 'stn-bob' },
    }, 'anna'))
    expect(foreign.code).toBe('station-forbidden')
    // The admin list shows every station, but the binding rule is strict:
    // the session binds the caller's own station.
    const admin = errorOf(await create(api, {
      sessionId: SessionId('s5'),
      executionTarget: { stationId: 'stn-anna' },
    }, 'admin'))
    expect(admin.code).toBe('station-forbidden')
  })

  it('answers stations-unavailable without the bridge or without a web identity', async () => {
    // No stations service in the composition.
    const bare = new Context()
    await bare.plugin(SessionStore)
    await bare.plugin(AgentRegistry)
    await bare.plugin(UserQuestionService)
    bare.provide('webAuth', {
      identityFromCookie: (cookie: string | undefined) => {
        const login = cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('login='))?.slice('login='.length)
        return login === undefined ? undefined : IDENTITIES[login]
      },
    } as never)
    const bareApi = createApiProxy(bare, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
      cwd: '/work/anna',
    })
    const withoutBridge = errorOf(await create(bareApi, {
      sessionId: SessionId('s6'),
      executionTarget: { stationId: 'stn-anna' },
    }, 'anna'))
    expect(withoutBridge.code).toBe('stations-unavailable')
    // Bridge present, but the caller rides no web request.
    const { api } = await harness()
    const withoutIdentity = errorOf(await create(api, {
      sessionId: SessionId('s7'),
      executionTarget: { stationId: 'stn-anna' },
    }))
    expect(withoutIdentity.code).toBe('stations-unavailable')
  })
})
