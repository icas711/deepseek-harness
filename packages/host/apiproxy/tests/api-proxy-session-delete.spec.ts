/**
 * sessions.delete delegation: the live path disposes the agent handle this
 * proxy owns before the durable log goes, the cold path inspects without
 * resuming, subagent-fenced identities refuse on both paths, and every
 * successful deletion forgets the workspace-registry accounting beside the
 * persistence removal. The persistence service is an in-memory double —
 * backend removal semantics live in the persistence contract suites.
 */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import type { HostFrame } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

let nextRpc = 1

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`delete-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

interface StoredSession {
  meta: SessionHeader
  events: SessionEvent[]
}

/** In-memory sessionPersistence double: listing, inspection, durable removal. */
function memoryPersistence() {
  const store = new Map<SessionId, StoredSession>()
  const deleted: SessionId[] = []
  return {
    deleted,
    seed(meta: SessionHeader, events: SessionEvent[] = []): void {
      store.set(meta.id, { meta, events })
    },
    has(id: SessionId): boolean {
      return store.has(id)
    },
    service: {
      list: () => Promise.resolve([...store.values()].map(entry => structuredClone(entry.meta))),
      inspect: (id: SessionId) => {
        const entry = store.get(id)
        return entry === undefined
          ? Promise.reject(new Error(`session "${id}" not found`))
          : Promise.resolve({ meta: structuredClone(entry.meta), events: structuredClone(entry.events) })
      },
      delete: (id: SessionId) => {
        deleted.push(id)
        store.delete(id)
        return Promise.resolve()
      },
    } as never,
  }
}

function stubAgent(session: Session): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
    wake: () => {},
  }
}

/** Compose the gateway over real Session/Agent/Storage/Workspace services. */
async function harness(withPersistence = true) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-delete-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  const persistence = memoryPersistence()
  if (withPersistence) ctx.provide('sessionPersistence', persistence.service)
  await ctx.plugin(WorkspaceRegistry)

  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = stubAgent(session)
      const unregister = ctx.agents.register(agent)
      return {
        agent,
        dispose: () => {
          unregister()
          return Promise.resolve()
        },
      }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: root,
  })
  return { api, ctx, persistence, root }
}

/** One live session created through the wire so the proxy owns its handle. */
async function wireSession(api: ReturnType<typeof createApiProxy>, root: string, id: string): Promise<SessionId> {
  const sessionId = SessionId(id)
  expectOk(await api.sessions.create(request({ cwd: root, sessionId })))
  return sessionId
}

describe('sessions.delete', () => {
  it('deletes a live proxy-owned session: agent disposed, log removed, archive slot forgotten', async () => {
    const { api, ctx, persistence, root } = await harness()
    const sessionId = await wireSession(api, root, 'live-delete')
    persistence.seed({ version: 1, id: sessionId, createdAt: 1, cwd: root })
    expectOk(await api.workspace.archiveSession(request({ sessionId })))
    expect(ctx.workspaceRegistry.archivedSessionIds).toContain(sessionId)

    const result = expectOk(await api.sessions.delete(request({ sessionId })))
    expect(result).toEqual({ deleted: true })
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(persistence.deleted).toEqual([sessionId])
    expect(persistence.has(sessionId)).toBe(false)
    expect(ctx.workspaceRegistry.archivedSessionIds).not.toContain(sessionId)
  })

  it('refuses a live session attached by another surface with session-ownership, deleting nothing', async () => {
    const { api, ctx, root } = await harness()
    const sessionId = SessionId('live-foreign')
    const session = ctx.sessions.create(sessionId, { meta: { cwd: root } })
    ctx.agents.register(stubAgent(session))

    const response = await api.sessions.delete(request({ sessionId }))
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'session-ownership', details: { sessionId } },
    })
    expect(ctx.agents.get(sessionId)).toBeDefined()
  })

  it('refuses a subagent-fenced live session with agent-busy', async () => {
    const { api, ctx, root } = await harness()
    const sessionId = SessionId('live-subagent')
    const session = ctx.sessions.create(sessionId, { meta: { cwd: root, origin: 'subagent' } })
    ctx.agents.register(stubAgent(session))

    const response = await api.sessions.delete(request({ sessionId }))
    expect(response.result).toMatchObject({
      ok: false,
      error: {
        code: 'agent-busy',
        details: { reason: 'use subagent delivery for this child session' },
      },
    })
  })

  it('deletes a cold session without resuming it and pushes host/session-removed once', async () => {
    const { api, persistence } = await harness()
    const sessionId = SessionId('cold-delete')
    persistence.seed({ version: 1, id: sessionId, createdAt: 1, cwd: '/proj' })

    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const removed = stream.next()

    const result = expectOk(await api.sessions.delete(request({ sessionId })))
    expect(result).toEqual({ deleted: true })
    expect(persistence.has(sessionId)).toBe(false)
    expect((await removed).value).toMatchObject({
      payload: { type: 'host/session-removed', sessionId },
    })
    abort.abort()
  })

  it('refuses a cold subagent-fenced header with agent-busy, keeping the log', async () => {
    const { api, persistence } = await harness()
    const sessionId = SessionId('cold-subagent')
    persistence.seed({ version: 1, id: sessionId, createdAt: 1, cwd: '/proj', origin: 'subagent' })

    const response = await api.sessions.delete(request({ sessionId }))
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'agent-busy', details: { reason: 'use subagent delivery for this child session' } },
    })
    expect(persistence.has(sessionId)).toBe(true)
  })

  it('maps an unknown cold id to session-not-found', async () => {
    const { api } = await harness()
    const sessionId = SessionId('never-stored')
    const response = await api.sessions.delete(request({ sessionId }))
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'session-not-found', details: { sessionId } },
    })
  })

  it('maps a failing durable removal to internal', async () => {
    const { api, persistence } = await harness()
    const sessionId = SessionId('cold-failing')
    persistence.seed({ version: 1, id: sessionId, createdAt: 1, cwd: '/proj' })
    const service = persistence.service as { delete: (id: SessionId) => Promise<void> }
    const original = service.delete.bind(service)
    service.delete = id => original(id).then(() => { throw new Error('disk full') })

    const response = await api.sessions.delete(request({ sessionId }))
    expect(response.result).toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('answers internal when the composition mounts no session-persistence service', async () => {
    const { api } = await harness(false)
    const response = await api.sessions.delete(request({ sessionId: SessionId('no-persistence') }))
    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('internal')
    expect(response.result.error.message).toContain('session-persistence')
  })
})
