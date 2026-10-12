// Live limits through the settings namespace: the composition entry stands
// until a user section overrides it, a write takes effect on the next fanout
// without a restart, an invalid write is refused at update, and a settings
// detach falls back to the entry limits. The service itself registers the
// namespace, so these tests write through the provider's own update path.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import Worktrees from '@deepseek-ai/dsh-worktree'
import Fleet from '@deepseek-ai/dsh-fleet'
import type { Agent } from '@deepseek-ai/dsh-agent'

const FLEET_NS = settingsNamespace('fleet')

let root: string | undefined
let ctx: Context | undefined
let settingsFiber: Fiber | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  settingsFiber = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot the fleet services over a real file settings provider; no git is touched. */
async function boot(): Promise<{ context: Context; repoPath: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-fleet-settings-'))
  const context = new Context()
  await mountAgentLoopTestDependencies(context)
  await context.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock-model' })
  context.llm.registerAdapter(['mock'], new MockAdapter([() => textResponse('done')]))
  settingsFiber = context.plugin(FileSettingsProvider, { path: join(root, 'settings.yaml') })
  await settingsFiber
  await context.plugin(AgentLoop, { agents: [] })
  await context.plugin(SubprocessLocal)
  await context.plugin(Worktrees)
  await context.plugin(Fleet)
  ctx = context
  return { context, repoPath: join(root, 'repo') }
}

/** An owner whose depth never blocks the count arm under test. */
function owner(): Agent {
  return { session: { header: { delegationDepth: 0 } } } as unknown as Agent
}

describe('fleet settings namespace', () => {
  it('keeps the composition entry limits until a user section overrides them', async () => {
    const { context, repoPath } = await boot()
    await expect(context.fleet.fanout({ repoPath, count: 6, prompt: 'p' }, owner()))
      .rejects.toThrow('fleet: count must be an integer between 1 and 5')

    await context.settings.update(FLEET_NS, { maxMembers: 2 })
    await expect(context.fleet.fanout({ repoPath, count: 3, prompt: 'p' }, owner()))
      .rejects.toThrow('fleet: count must be an integer between 1 and 2')
  })

  it('refuses a limits write the fanout caps could not act on', async () => {
    const { context, repoPath } = await boot()
    await expect(context.settings.update(FLEET_NS, { maxMembers: 0 }))
      .rejects.toThrow('fleet: maxMembers must be a positive integer')
    await expect(context.fleet.fanout({ repoPath, count: 6, prompt: 'p' }, owner()))
      .rejects.toThrow('fleet: count must be an integer between 1 and 5')
  })

  it('applies a depth override on the next fanout', async () => {
    const { context, repoPath } = await boot()
    await context.settings.update(FLEET_NS, { maxFanoutDepth: 0 })
    await expect(context.fleet.fanout({ repoPath, count: 1, prompt: 'p' }, owner()))
      .rejects.toThrow('fleet: fanout depth cap reached (0)')
  })

  it('falls back to the entry limits when the settings provider detaches', async () => {
    const { context, repoPath } = await boot()
    await context.settings.update(FLEET_NS, { maxMembers: 2 })
    await expect(context.fleet.fanout({ repoPath, count: 3, prompt: 'p' }, owner()))
      .rejects.toThrow('fleet: count must be an integer between 1 and 2')
    await settingsFiber!.dispose()
    // The override's ceiling is gone with its source: the entry cap stands again.
    await expect(context.fleet.fanout({ repoPath, count: 6, prompt: 'p' }, owner()))
      .rejects.toThrow('fleet: count must be an integer between 1 and 5')
  })
})
