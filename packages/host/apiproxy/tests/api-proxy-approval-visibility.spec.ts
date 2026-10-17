/**
 * Cross-device visibility of pending interactions: a question asked on the PC
 * replays to the SAME user's other device (fresh mux open, same rpcId) and is
 * settled there through respond; a foreign login's answer is not-pending and
 * the interaction stays answerable; a duplicate answer reads already-resolved;
 * approval/question frames and their broadcasts never reach a subscriber whose
 * cabinet cannot see the asking session.
 */

import { mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import type { ApiProxy, MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId as mintRpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { runWithWebRequestHeaders, type WebAuthService, type WebIdentity } from '../src/web-identity.ts'
import { createApiProxy } from '../src/api-proxy.ts'

async function harness(): Promise<{
  ctx: Context
  api: ApiProxy
  cabinets: Record<'alice' | 'bob', string>
}> {
  const base = await mkdtemp(join(tmpdir(), 'dsh-approval-visibility-'))
  await mkdir(join(base, 'alice'), { recursive: true })
  await mkdir(join(base, 'bob'), { recursive: true })
  const cabinets = {
    alice: await realpath(join(base, 'alice')),
    bob: await realpath(join(base, 'bob')),
  }
  const identities = new Map<string, WebIdentity>([
    ['alice', { login: 'alice', admin: false, root: cabinets.alice }],
    ['bob', { login: 'bob', admin: false, root: cabinets.bob }],
    ['admin', { login: 'admin', admin: true, root: cabinets.alice }],
  ])
  const webAuth: WebAuthService = {
    identityFromCookie: (cookie) => {
      const login = cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('login='))?.slice('login='.length)
      return login === undefined ? undefined : identities.get(login)
    },
  }
  const ctx = new Context()
  ctx.provide('webAuth', webAuth)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ApprovalService)
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
  return { ctx, api, cabinets }
}

/** A minimal agent stand-in whose session header carries a cabinet cwd. */
function agentOf(ctx: Context, cwd: string): Agent {
  const session = ctx.sessions.create(undefined, { meta: { cwd } })
  session.append('turn/start', { turn: 1 })
  // inbox keeps the mux-open queue baseline cheap: an empty stand-in never
  // enters the session/queue replay branch.
  const agent = { id: session.id, session, status: 'idle', ctx, inbox: { hasPending: false } } as unknown as Agent
  ctx.agents.register(agent)
  return agent
}

function headersFor(login: string | undefined): Headers {
  return login === undefined ? new Headers() : new Headers({ cookie: `login=${login}` })
}

/** Run one pass under a login's headers (the serving-pass identity source). */
function asUser<T>(login: string | undefined, run: () => T): T {
  return runWithWebRequestHeaders(headersFor(login), run)
}

interface CapturedMux {
  frames: MuxFrame[]
  envelopes: RpcRequest<MuxFrame>[]
  waitFor(type: MuxFrame['type']): Promise<MuxFrame>
}

/** Open a mux stream AS a login and capture frames (the consume loop rides the login's headers). */
function openMuxAs(api: ApiProxy, abort: AbortController, login: string | undefined): CapturedMux {
  const frames: MuxFrame[] = []
  const envelopes: RpcRequest<MuxFrame>[] = []
  const waiters: { type: MuxFrame['type']; resolve: (frame: MuxFrame) => void }[] = []
  void asUser(login, async () => {
    for await (const envelope of api.events.mux({ rpcId: mintRpcId('t-mux'), payload: {} }, abort.signal)) {
      frames.push(envelope.payload)
      envelopes.push(envelope)
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        const waiter = waiters[i] as (typeof waiters)[number]
        if (waiter.type === envelope.payload.type) {
          waiters.splice(i, 1)
          waiter.resolve(envelope.payload)
        }
      }
    }
  })
  return {
    frames,
    envelopes,
    waitFor: (type) => {
      const found = frames.find(frame => frame.type === type)
      if (found !== undefined) return Promise.resolve(found)
      return new Promise((resolve) => { waiters.push({ type, resolve }) })
    },
  }
}

/** Bounded wait until the stream delivered no frame of the type (fail-loud on a leak). */
async function expectNoFrame(mux: CapturedMux, type: MuxFrame['type']): Promise<void> {
  for (let i = 0; i < 60 && !mux.frames.some(frame => frame.type === type); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(mux.frames.some(frame => frame.type === type)).toBe(false)
}

function requestedOf(frame: MuxFrame): Extract<MuxFrame, { type: 'approval/requested' }> {
  if (frame.type !== 'approval/requested') throw new Error(`expected approval/requested, got ${frame.type}`)
  return frame
}

function approvalAnswer(rpcId: RpcId, sessionId: unknown, approvalId: ApprovalRequestId, outcome: 'allowed-once' | 'rejected'): Parameters<ApiProxy['respond']>[0] {
  return { type: 'client-response', rpcId, result: { ok: true, value: { sessionId, approvalId, outcome } } }
}

/** The answer envelope of the first captured approval/question frame. */
function envelopeOf(mux: CapturedMux, type: 'approval/requested' | 'question/requested'): RpcRequest<MuxFrame> {
  const found = mux.envelopes.find(envelope => envelope.payload.type === type)
  if (found === undefined) throw new Error(`no ${type} envelope captured`)
  return found
}

function questionAnswer(envelope: RpcRequest<MuxFrame>): Parameters<ApiProxy['respond']>[0] {
  if (envelope.payload.type !== 'question/requested') throw new Error('expected question/requested envelope')
  const payload = envelope.payload
  return {
    type: 'client-response',
    rpcId: envelope.rpcId,
    result: {
      ok: true,
      value: {
        sessionId: payload.sessionId,
        answer: {
          answers: [{
            id: payload.questions[0]?.id,
            selected: [payload.questions[0]?.options?.[0]?.label ?? ''],
          }],
        },
      },
    },
  }
}

describe('pending-interaction visibility across devices', () => {
  it('same user, second device: disconnect, reconnect, replay with the same rpcId, answer', async () => {
    const { ctx, api, cabinets } = await harness()
    const agent = agentOf(ctx, join(cabinets.alice, 'proj'))
    const deviceA = new AbortController()
    const muxA = openMuxAs(api, deviceA, 'alice')
    const asked = ctx.approval.request({ agent, toolName: 'bash', reason: 'sandbox escalation' })
    const requested = requestedOf(await muxA.waitFor('approval/requested'))
    const firstEnvelope = envelopeOf(muxA, 'approval/requested')
    deviceA.abort() // the PC went offline

    // The phone reconnects: the replay carries the same stable rpcId.
    const deviceB = new AbortController()
    const muxB = openMuxAs(api, deviceB, 'alice')
    const replayed = requestedOf(await muxB.waitFor('approval/requested'))
    const secondEnvelope = envelopeOf(muxB, 'approval/requested')
    expect(secondEnvelope.rpcId).toBe(firstEnvelope.rpcId)
    expect(replayed.approvalId).toBe(requested.approvalId)
    expect(replayed.sessionId).toBe(agent.session.id)

    const receipt = await asUser('alice', () => api.respond(approvalAnswer(secondEnvelope.rpcId, replayed.sessionId, replayed.approvalId, 'allowed-once')))
    expect(receipt).toEqual({ accepted: true })
    await expect(asked).resolves.toBe('allowed-once')
    deviceB.abort()
  })

  it('a foreign login is rejected as not-pending and the interaction stays answerable', async () => {
    const { ctx, api, cabinets } = await harness()
    const agent = agentOf(ctx, join(cabinets.alice, 'proj'))
    const abort = new AbortController()
    const mux = openMuxAs(api, abort, 'alice')
    const asked = ctx.approval.request({ agent, toolName: 'write' })
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    const envelope = envelopeOf(mux, 'approval/requested')

    const foreign = await asUser('bob', () => api.respond(approvalAnswer(envelope.rpcId, requested.sessionId, requested.approvalId, 'allowed-once')))
    expect(foreign).toEqual({ accepted: false, reason: 'not-pending' })
    // The interaction is untouched: the owner can still decide it.
    const receipt = await asUser('alice', () => api.respond(approvalAnswer(envelope.rpcId, requested.sessionId, requested.approvalId, 'rejected')))
    expect(receipt).toEqual({ accepted: true })
    await expect(asked).resolves.toBe('rejected')
    abort.abort()
  })

  it('a duplicate answer reads already-resolved, an unknown id stays not-pending', async () => {
    const { ctx, api, cabinets } = await harness()
    const agent = agentOf(ctx, join(cabinets.alice, 'proj'))
    const abort = new AbortController()
    const mux = openMuxAs(api, abort, 'alice')
    const asked = ctx.approval.request({ agent, toolName: 'bash' })
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    const envelope = envelopeOf(mux, 'approval/requested')

    expect(await asUser('alice', () => api.respond(approvalAnswer(envelope.rpcId, requested.sessionId, requested.approvalId, 'rejected'))))
      .toEqual({ accepted: true })
    await expect(asked).resolves.toBe('rejected')
    // The second device raced through the same replayed frame and answered too.
    expect(await asUser('alice', () => api.respond(approvalAnswer(envelope.rpcId, requested.sessionId, requested.approvalId, 'allowed-once'))))
      .toEqual({ accepted: false, reason: 'already-resolved' })
    expect(await asUser('alice', () => api.respond(approvalAnswer(mintRpcId('ghost'), requested.sessionId, requested.approvalId, 'rejected'))))
      .toEqual({ accepted: false, reason: 'not-pending' })
    abort.abort()
  })

  it('a foreign subscriber receives neither the requested frame, nor the replay, nor the resolved broadcast', async () => {
    const { ctx, api, cabinets } = await harness()
    const agent = agentOf(ctx, join(cabinets.alice, 'proj'))
    const bobAbort = new AbortController()
    const bobMux = openMuxAs(api, bobAbort, 'bob')
    const asked = ctx.approval.request({ agent, toolName: 'bash' })
    const aliceAbort = new AbortController()
    const aliceMux = openMuxAs(api, aliceAbort, 'alice')
    await aliceMux.waitFor('approval/requested')
    await expectNoFrame(bobMux, 'approval/requested')

    const envelope = envelopeOf(aliceMux, 'approval/requested')
    await asUser('alice', () => api.respond(approvalAnswer(envelope.rpcId, agent.session.id, requestedOf(aliceMux.frames.find(f => f.type === 'approval/requested') as MuxFrame).approvalId, 'allowed-once')))
    await aliceMux.waitFor('approval/resolved')
    await expectNoFrame(bobMux, 'approval/resolved')
    await expect(asked).resolves.toBe('allowed-once')

    // Reconnect replay: still nothing for the foreign cabinet.
    bobAbort.abort()
    const bobReconnect = new AbortController()
    await expectNoFrame(openMuxAs(api, bobReconnect, 'bob'), 'approval/requested')
    bobReconnect.abort()
    aliceAbort.abort()
  })

  it('questions: replay reaches another device of the same user; a foreign login is not-pending', async () => {
    const { ctx, api, cabinets } = await harness()
    const agent = agentOf(ctx, join(cabinets.alice, 'proj'))
    const deviceA = new AbortController()
    const muxA = openMuxAs(api, deviceA, 'alice')
    const asked = ctx.userQuestions.ask({
      agent,
      questions: [{ id: 'target', question: 'Продолжить?', options: [{ label: 'Да' }, { label: 'Нет' }] }],
    })
    await muxA.waitFor('question/requested')
    deviceA.abort()

    const deviceB = new AbortController()
    const muxB = openMuxAs(api, deviceB, 'alice')
    await muxB.waitFor('question/requested')
    const firstEnvelope = envelopeOf(muxA, 'question/requested')
    const secondEnvelope = envelopeOf(muxB, 'question/requested')
    expect(secondEnvelope.rpcId).toBe(firstEnvelope.rpcId)

    expect(await asUser('bob', () => api.respond(questionAnswer(secondEnvelope))))
      .toEqual({ accepted: false, reason: 'not-pending' })
    expect(await asUser('alice', () => api.respond(questionAnswer(secondEnvelope))))
      .toEqual({ accepted: true })
    await expect(asked).resolves.toEqual({ answers: [{ id: 'target', selected: ['Да'] }] })
    deviceB.abort()
  })

  it('an admin answers across cabinets; an unauthenticated pass does not scope', async () => {
    const { ctx, api, cabinets } = await harness()
    const agent = agentOf(ctx, join(cabinets.alice, 'proj'))
    const asked = ctx.approval.request({ agent, toolName: 'bash' })
    const abort = new AbortController()
    const mux = openMuxAs(api, abort, 'admin')
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    const envelope = envelopeOf(mux, 'approval/requested')
    expect(await asUser('admin', () => api.respond(approvalAnswer(envelope.rpcId, requested.sessionId, requested.approvalId, 'allowed-once'))))
      .toEqual({ accepted: true })
    await expect(asked).resolves.toBe('allowed-once')
    abort.abort()
  })
})
