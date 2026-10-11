// Full-lifecycle fleet behavior over the real agent loop: a fanout starts member
// sessions whose turns run a tool that writes into their own worktree, the diff
// shows each attempt's file, the winner merges, cleanup removes the artifacts,
// and the owner fence rejects a foreign caller.
import { execFile } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, toolCallResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import Worktrees from '@deepseek-ai/dsh-worktree'
import Fleet, { FleetForeignOwnerError } from '@deepseek-ai/dsh-fleet'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'

const exec = promisify(execFile)

let root: string | undefined
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Create a temporary git repository with one commit on `main`. */
async function makeRepo(dir: string): Promise<string> {
  const repo = join(dir, 'repo')
  await mkdir(repo, { recursive: true })
  await exec('git', ['-C', repo, 'init', '-b', 'main'])
  await exec('git', ['-C', repo, 'config', 'user.email', 'fleet@test'])
  await exec('git', ['-C', repo, 'config', 'user.name', 'fleet test'])
  await writeFile(join(repo, 'hello.txt'), 'hello\n')
  await exec('git', ['-C', repo, 'add', '.'])
  await exec('git', ['-C', repo, 'commit', '-m', 'init'])
  return repo
}

/**
 * Boot the full member-driving stack: loop prerequisites, the mock route as the
 * default model, a per-session scripted adapter whose first call answers with a
 * `write_attempt` tool call, and the fleet services over real git.
 */
async function boot(): Promise<{ context: Context; adapter: MockAdapter }> {
  const context = new Context()
  await mountAgentLoopTestDependencies(context)
  await context.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock-model' })
  // First stream of every session drives the write tool; the second finishes.
  const seen = new Map<string, number>()
  const respond = (options: { sessionId?: string }): ReturnType<typeof textResponse> => {
    const key = options.sessionId ?? 'anonymous'
    const call = seen.get(key) ?? 0
    seen.set(key, call + 1)
    return call === 0
      ? toolCallResponse(`call-${key.replace(/[^a-z0-9]/gi, '')}-1`, 'write_attempt', { text: `attempt ${key}` })
      : textResponse('done')
  }
  const adapter = new MockAdapter(Array.from({ length: 12 }, () => respond))
  const disposeAdapter = context.llm.registerAdapter(['mock'], adapter)
  context.tools.register(defineTool({
    name: 'write_attempt',
    description: 'Append one line to attempt.txt in the session workspace.',
    parameters: { text: { type: 'string', required: true, description: 'Line to append.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined) throw new Error('write_attempt requires a session cwd')
      return appendFile(join(cwd, 'attempt.txt'), `${args.text}\n`).then(() => ({ ok: true }))
    },
    presentCall: () => undefined,
  }))
  await context.plugin(AgentLoop, { agents: [] })
  await context.plugin(SubprocessLocal)
  await context.plugin(Worktrees)
  await context.plugin(Fleet)
  ctx = context
  ;(context as unknown as { __disposeAdapter: () => void }).__disposeAdapter = disposeAdapter
  return { context, adapter }
}

/** Await one agent's quiescence, failing loudly when it never settles. */
async function awaitIdle(context: Context, sessionId: SessionId, what: string): Promise<void> {
  const agent: Agent | undefined = context.agents.get(sessionId)
  if (agent === undefined) throw new Error(`${what} left no live agent`)
  await agent.whenIdle()
}

describe('Fleet over the real agent loop and git', () => {
  it('fans out, drives member turns in isolated worktrees, and reports statuses', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-fleet-'))
    const repo = await makeRepo(root)
    const { context } = await boot()
    const owner = (await context.agents.create({ sessionId: SessionId('owner-1') })).agent

    const snapshot = await context.fleet.fanout({ repoPath: repo, count: 2, prompt: 'write your attempt' }, owner)
    expect(snapshot.members).toHaveLength(2)
    expect(new Set(snapshot.members.map(member => member.worktreePath)).size).toBe(2)

    for (const member of snapshot.members) await awaitIdle(context, member.sessionId, 'member')
    await awaitIdle(context, SessionId('owner-1'), 'owner notice turn')

    const [status] = context.fleet.status(owner, snapshot.id)
    expect(status?.members.every(member => member.state === 'idle')).toBe(true)

    // Each attempt wrote into its own isolated worktree.
    for (const member of snapshot.members) {
      const text = await readFile(join(member.worktreePath, 'attempt.txt'), 'utf8')
      expect(text).toContain('attempt ')
    }
    const diffs = await context.fleet.diff(owner, snapshot.id)
    expect(diffs).toHaveLength(2)
    expect(diffs[0]?.diff.stat).toContain('(untracked) attempt.txt')
  }, 120_000)

  it('merges one winner and cleans the fanout away', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-fleet-'))
    const repo = await makeRepo(root)
    const { context } = await boot()
    const owner = (await context.agents.create({ sessionId: SessionId('owner-2') })).agent
    const snapshot = await context.fleet.fanout({ repoPath: repo, count: 2, prompt: 'write your attempt' }, owner)
    for (const member of snapshot.members) await awaitIdle(context, member.sessionId, 'member')
    await awaitIdle(context, SessionId('owner-2'), 'owner notice turn')

    const winner = snapshot.members[0]!
    const merged = await context.fleet.merge(owner, snapshot.id, winner.sessionId)
    expect(['merged', 'up-to-date']).toContain(merged.status)
    const after = context.fleet.status(owner, snapshot.id)[0]
    expect(after?.mergedSessionId).toBe(winner.sessionId)

    await context.fleet.cleanup(owner, snapshot.id)
    const listed = await context.worktrees.list(repo)
    expect(listed.some(record => record.path === winner.worktreePath)).toBe(false)
    expect(() => context.fleet.status(owner, snapshot.id)).toThrow(/unknown fanout/)
  }, 120_000)

  it('rejects a foreign caller through the owner fence', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-fleet-'))
    const repo = await makeRepo(root)
    const { context } = await boot()
    const owner = (await context.agents.create({ sessionId: SessionId('owner-3') })).agent
    const snapshot = await context.fleet.fanout({ repoPath: repo, count: 1, prompt: 'x' }, owner)
    const stranger = (await context.agents.create({ sessionId: SessionId('stranger-1') })).agent
    expect(() => context.fleet.status(stranger, snapshot.id)).toThrow(FleetForeignOwnerError)
    await context.fleet.cleanup(owner, snapshot.id)
  }, 120_000)

  it('refuses an over-deep or oversized request before touching git', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-fleet-'))
    const repo = await makeRepo(root)
    const { context } = await boot()
    const owner = (await context.agents.create({ sessionId: SessionId('owner-4') })).agent
    await expect(context.fleet.fanout({ repoPath: repo, count: 99, prompt: 'x' }, owner)).rejects.toThrow(/count/)
    await expect(context.fleet.fanout({ repoPath: join(root, 'missing'), count: 1, prompt: 'x' }, owner)).rejects.toThrow()
  }, 120_000)
})
