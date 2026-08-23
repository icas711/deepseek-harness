/**
 * Quota-pause behavior over the real loop: a quota-refused turn parks its
 * input durably, later proposals wait parked, resume releases the work
 * without re-surfacing it, and adoption over a refused log starts parked.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import QuotaPause, { hasParkedQuotaWork, quotaRefusedWindow } from '../src/index.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** The live Z.ai shape this guard exists for: a 5-hour usage-limit refusal. */
const QUOTA_REFUSAL_MESSAGE =
  'Usage limit reached for 5 hour. Your limit will reset at 2026-08-16 03:12:02'

function quotaRefusal(): StreamChunk[] {
  return [{
    type: 'finish',
    reason: { kind: 'error', failure: { message: QUOTA_REFUSAL_MESSAGE, code: 'QUOTA' } },
  }]
}

async function harness(adapter: MockAdapter, root?: string) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (root !== undefined) await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(QuotaPause)
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function send(agent: Agent, text: string) {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function surfacedTexts(agent: Agent): string[] {
  return agent.session.events
    .filter(event => event.type === 'user/message')
    .map(event => event.data.content.map(block => (block.type === 'text' ? block.text : '')).join(''))
}

describe('QuotaPause over the real loop', () => {
  it('parks the refused turn\'s input and holds later proposals without model calls', async () => {
    const adapter = new MockAdapter([quotaRefusal(), textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('park'), { provider: 'mock', model: 'mock' })

    send(agent, 'the parked task')
    await agent.whenIdle()

    // The refusal surfaced as the turn's error with the provider's own text.
    const end = agent.session.events.at(-1)
    expect(end?.type === 'turn/end' && end.data.reason).toEqual({
      kind: 'error',
      error: { message: QUOTA_REFUSAL_MESSAGE, code: 'QUOTA' },
    })
    // The claimed input went back to the inbox, durably pending.
    expect(agent.inbox.nextTurn.map(message => message.content[0])).toEqual([
      { type: 'text', text: 'the parked task' },
    ])
    expect(ctx.quotaPause.isPaused(agent)).toBe(true)

    // A later proposal waits parked: no model call, turn closes blocked.
    send(agent, 'meanwhile')
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(agent.inbox.nextTurn.map(message => message.content[0])).toEqual([
      { type: 'text', text: 'the parked task' },
      { type: 'text', text: 'meanwhile' },
    ])
    expect(hasParkedQuotaWork(agent)).toBe(true)
    await ctx.fiber.dispose()
  })

  it('resume spends the parked input over the recorded log without re-surfacing it', async () => {
    const adapter = new MockAdapter([quotaRefusal(), textResponse('continued after reset')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('resume'), { provider: 'mock', model: 'mock' })

    send(agent, 'the parked task')
    await agent.whenIdle()
    expect(ctx.quotaPause.resume(agent)).toBe(true)
    await agent.whenIdle()

    // The released turn ran exactly one request over history holding the
    // recorded input exactly once, and surfaced no new copy of it.
    expect(adapter.requests).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[1]?.messages).match(/the parked task/g)).toHaveLength(1)
    expect(surfacedTexts(agent)).toEqual(['the parked task'])
    expect(agent.inbox.hasPending).toBe(false)
    expect(ctx.quotaPause.isPaused(agent)).toBe(false)
    await ctx.fiber.dispose()
  })

  it('resume surfaces input that arrived after the refusal, alongside the silent parked batch', async () => {
    const adapter = new MockAdapter([quotaRefusal(), textResponse('done'), textResponse('also done')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('mixed'), { provider: 'mock', model: 'mock' })

    send(agent, 'the parked task')
    await agent.whenIdle()
    send(agent, 'typed while parked')
    await agent.whenIdle()

    expect(ctx.quotaPause.resume(agent)).toBe(true)
    await agent.whenIdle()

    // The parked task resumed over the log; the message typed while parked
    // then took its own turn, surfaced exactly once.
    expect(surfacedTexts(agent)).toEqual(['the parked task', 'typed while parked'])
    expect(adapter.requests).toHaveLength(3)
    expect(agent.inbox.hasPending).toBe(false)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    })
    await ctx.fiber.dispose()
  })

  it('resume answers false when the log does not end in a quota refusal', async () => {
    const adapter = new MockAdapter([textResponse('fine')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('healthy'), { provider: 'mock', model: 'mock' })

    send(agent, 'hello')
    await agent.whenIdle()
    expect(ctx.quotaPause.resume(agent)).toBe(false)
    await ctx.fiber.dispose()
  })

  it('a still-exhausted provider re-parks the released work', async () => {
    const adapter = new MockAdapter([quotaRefusal(), quotaRefusal()])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('twice'), { provider: 'mock', model: 'mock' })

    send(agent, 'the parked task')
    await agent.whenIdle()
    expect(ctx.quotaPause.resume(agent)).toBe(true)
    await agent.whenIdle()

    // The second refusal re-parked the same input for a later release.
    expect(adapter.requests).toHaveLength(2)
    expect(ctx.quotaPause.isPaused(agent)).toBe(true)
    expect(agent.inbox.nextTurn.map(message => message.content[0])).toEqual([
      { type: 'text', text: 'the parked task' },
    ])
    await ctx.fiber.dispose()
  })

  it('adoption over a refused log starts parked instead of re-failing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-quota-pause-'))
    try {
      // Crash-shaped persistence: the refusal and its park splice reach the
      // disk, the clean-shutdown inbox cancellation does not (a disposed
      // agent cancels pending input; with the backend already gone, that
      // cancel cannot persist).
      const first = await harness(new MockAdapter([quotaRefusal()]))
      const persistence = await first.plugin(JsonlSessionPersistence, { root })
      const sessionId = SessionId('adopted')
      const agent = first.agentLoop.create(sessionId, { provider: 'mock', model: 'mock' })

      send(agent, 'the parked task')
      await agent.whenIdle()
      await first.sessions.flush(agent.session)
      await persistence.dispose()
      await first.fiber.dispose()

      // A later process adopts the persisted log: the window is the refused
      // turn, the parked input replayed pending, and the adopted agent
      // starts parked — the queued wake never spends a model call against
      // the dead quota.
      const adapter = new MockAdapter([textResponse('must not run')])
      const rebooted = await harness(adapter, root)
      const handle = await rebooted.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      const adopted = handle.agent
      await adopted.whenIdle()
      const window = quotaRefusedWindow(adopted.session.events)
      expect(window).toBeDefined()
      expect(adopted.session.events[window![0]]?.type).toBe('turn/start')
      expect(adopted.session.events[window![1]]?.type).toBe('turn/end')
      expect(rebooted.quotaPause.isPaused(adopted)).toBe(true)
      send(adopted, 'post-restart input')
      await adopted.whenIdle()
      expect(adapter.requests).toHaveLength(0)
      await handle.dispose()
      await rebooted.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
