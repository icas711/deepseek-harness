// Real composition through the Loader: a tracked task survives a full
// context dispose as `paused`, and the next boot reopens its session from
// persistence and delivers the continuation as ordinary logged input that
// reaches the mock model. A predecessor's `running` record boots as
// `interrupted` and is deliberately not auto-resumed.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter'
import TaskSupervisor, { CONTINUATION_PROMPT } from '../src/index.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

const SESSION_ID = SessionId('dsh-task-supervisor-e2e')

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.fiber.dispose()
  }
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Composition paths shared by both boots of one scenario. */
interface Paths {
  registryPath: string
  persistRoot: string
  projectDir: string
  home: string
}

async function makePaths(): Promise<Paths> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-task-supervisor-loader-'))
  return {
    registryPath: join(root, 'task-registry.json'),
    persistRoot: join(root, 'sessions'),
    projectDir: join(root, 'project'),
    home: join(root, 'home'),
  }
}

/**
 * Boot the test-only composition through the real Loader. Row order is
 * load-bearing: the adapter registers before the supervisor row mounts, so
 * the post-boot auto-resume always finds a route for its continuation turn.
 */
async function boot(adapter: MockAdapter, paths: Paths): Promise<Context> {
  const adapterRow = {
    name: 'test-llm-adapter',
    inject: ['llm'],
    apply: (ctx: Context) => {
      ctx.llm.registerAdapter(['mock'], adapter)
    },
  }
  const configPath = join(paths.home, 'cordis.yml')
  await mkdir(paths.home, { recursive: true })
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-agent-loop'",
    '  config:',
    '    agents: []',
    "- name: 'test-llm-adapter'",
    "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    '  config:',
    `      root: '${paths.persistRoot.replace(/\\/g, '/')}'`,
    '      compression: none',
    '      writeBatchMaxDelayMs: 10',
    "- name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '      provider: mock',
    '      model: mock-model',
    "- name: '@deepseek-ai/dsh-task-supervisor'",
    '  config:',
    `      registryPath: '${paths.registryPath.replace(/\\/g, '/')}'`,
    '',
  ].join('\n'))
  const context = new Context()
  contexts.push(context)
  context.baseUrl = pathToFileURL(paths.home).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-session-persistence-jsonl', SessionPersistenceJsonl],
    ['@deepseek-ai/dsh-agent-default-model', AgentDefaultModel],
    ['@deepseek-ai/dsh-task-supervisor', TaskSupervisor],
    ['test-llm-adapter', adapterRow],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

interface DiskTask {
  taskId: string
  sessionId: string
  status: string
}

async function readRegistry(registryPath: string): Promise<{ tasks: DiskTask[] }> {
  const parsed: unknown = JSON.parse(await readFile(registryPath, 'utf8'))
  return parsed as { tasks: DiskTask[] }
}

/** Wait until the live agent's log carries the supervisor's continuation input. */
async function waitForContinuation(context: Context): Promise<Agent> {
  let agent: Agent | undefined
  await vi.waitFor(async () => {
    agent = context.agents.get(SESSION_ID)
    expect(agent).toBeDefined()
    const logged = agent?.session.events.some(event =>
      event.type === 'user/message' && JSON.stringify(event.data).includes('рестартом сервера'))
    expect(logged).toBe(true)
  }, { timeout: 10_000, interval: 25 })
  return agent as Agent
}

describe('task-supervisor Loader composition', () => {
  it('parks a tracked task on dispose and resumes it on the next boot', async () => {
    const paths = await makePaths()
    const first = await boot(new MockAdapter([textResponse('Начало сделано.')]), paths)
    await first.agents.create({ sessionId: SESSION_ID, meta: { cwd: paths.projectDir } })
    const agent = first.agents.get(SESSION_ID) as Agent
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Начало работы' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    const task = await first.taskSupervisor.track({ sessionId: SESSION_ID, title: 'Перенести отчёты' })
    expect(task.status).toBe('running')
    await first.sessions.flush(agent.session)

    const parked = await readRegistry(paths.registryPath)
    expect(parked.tasks[0]).toMatchObject({ sessionId: SESSION_ID, status: 'running' })

    // The clean unload parks every running task before teardown.
    await first.fiber.dispose()
    contexts.length = 0
    expect((await readRegistry(paths.registryPath)).tasks[0]?.status).toBe('paused')

    // The next boot reopens the cold session and delivers the continuation.
    const second = new MockAdapter([textResponse('Продолжаю.')])
    const rebooted = await boot(second, paths)
    const resumed = await waitForContinuation(rebooted)
    await resumed.whenIdle()

    expect(second.requests).toHaveLength(1)
    const userMessages = second.requests[0]?.messages.filter(message => message.role === 'user') ?? []
    expect(userMessages.at(-1)?.content).toEqual([{ type: 'text', text: CONTINUATION_PROMPT }])
    // The reopened session restored the predecessor's history, so the model
    // can rebuild context exactly as the continuation asks.
    expect(second.requests[0]?.messages.some(message =>
      message.role === 'user' && JSON.stringify(message.content).includes('Начало работы'))).toBe(true)

    const resumedRecord = (await readRegistry(paths.registryPath)).tasks[0]
    expect(resumedRecord).toMatchObject({ taskId: task.taskId, status: 'running' })
  }, 60_000)

  it('boots a predecessor running record as interrupted without resuming it', async () => {
    const paths = await makePaths()
    await writeFile(paths.registryPath, JSON.stringify({
      version: 1,
      tasks: [{ taskId: 'task-lost', sessionId: SESSION_ID, title: 'Пропавшая', status: 'running', updatedAt: 1 }],
    }), 'utf8')
    const adapter = new MockAdapter([])
    const context = await boot(adapter, paths)
    // A hard crash is surfaced, not retried: the record flips to interrupted
    // and no session opens, so no model request is ever made.
    expect((await context.taskSupervisor.list())[0]?.status).toBe('interrupted')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(context.agents.get(SESSION_ID)).toBeUndefined()
    expect(adapter.requests).toEqual([])
    expect((await readRegistry(paths.registryPath)).tasks[0]?.status).toBe('interrupted')
  }, 30_000)
})
