import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import TaskSupervisor, { CONTINUATION_PROMPT, buildContinuationMessage, TaskSupervisorError } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface Harness { supervisor: TaskSupervisor; registryPath: string }

/** Boot one supervisor over a fresh temporary registry. */
async function boot(configure?: (registryPath: string) => Promise<void>): Promise<Harness> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-task-supervisor-'))
  const registryPath = join(root, 'task-registry.json')
  await configure?.(registryPath)
  context = new Context()
  await context.plugin(AgentRegistry)
  const fiber = context.plugin(TaskSupervisor, { registryPath })
  await fiber.await()
  return { supervisor: context.taskSupervisor, registryPath }
}

/** One on-disk task entry as the test reads it back. */
interface DiskTask {
  taskId: string
  sessionId: string
  title: string
  status: string
  updatedAt: number
}

async function readRegistry(registryPath: string): Promise<{ tasks: DiskTask[] }> {
  return JSON.parse(await readFile(registryPath, 'utf8'))
}

describe('CONTINUATION_PROMPT', () => {
  it('pins the model-visible continuation literal verbatim', () => {
    expect(CONTINUATION_PROMPT).toMatchInlineSnapshot(
      '"Задача была прервана рестартом сервера. Продолжи выполнение с места остановки; сначала кратко восстанови контекст по истории."',
    )
  })

  it('rides the ordinary logged user input path with the plugin source', () => {
    const message = buildContinuationMessage()
    expect(message.role).toBe('user')
    expect(message.source).toEqual({ kind: 'plugin', plugin: '@deepseek-ai/dsh-task-supervisor' })
    expect(message.content).toEqual([{ type: 'text', text: CONTINUATION_PROMPT }])
  })
})

describe('TaskSupervisor service', () => {
  it('boots passively over an absent registry', async () => {
    const { supervisor, registryPath } = await boot()
    expect(await supervisor.list()).toEqual([])
    await expect(readFile(registryPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails the boot loud on a corrupt registry document', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-task-supervisor-'))
    const registryPath = join(root, 'task-registry.json')
    await writeFile(registryPath, 'not json', 'utf8')
    // A bare single-plugin context: a fiber failing as the SECOND plugin in a
    // context trips an unrelated unhandled-rejection report in the test
    // invariant host, so this boot stays minimal on purpose.
    context = new Context()
    await expect(context.plugin(TaskSupervisor, { registryPath }).await()).rejects.toThrow(/task registry/)
  })

  it('tracks idempotently by session id and persists the running record', async () => {
    const { supervisor, registryPath } = await boot()
    const first = await supervisor.track({ sessionId: SessionId('s1'), title: 'Перенести отчёты' })
    const again = await supervisor.track({ sessionId: SessionId('s1'), title: 'Перенести отчёты' })
    expect(again.taskId).toBe(first.taskId)
    expect(first.status).toBe('running')
    const disk = await readRegistry(registryPath)
    expect(disk.tasks).toHaveLength(1)
    expect(disk.tasks[0]).toMatchObject({ sessionId: 's1', title: 'Перенести отчёты', status: 'running' })
  })

  it('marks completed and failed, refusing bad transitions and empty reasons', async () => {
    const { supervisor } = await boot()
    const task = await supervisor.track({ sessionId: SessionId('s1'), title: 'Работа' })
    await expect(supervisor.markFailed(task.taskId, '   ')).rejects.toMatchObject({ code: 'invalid-reason' })
    await expect(supervisor.markCompleted('task-unknown' as never)).rejects.toMatchObject({ code: 'unknown-task' })
    const failed = await supervisor.markFailed(task.taskId, 'сеть недоступна')
    expect(failed.status).toBe('failed')
    await expect(supervisor.markCompleted(task.taskId)).rejects.toMatchObject({ code: 'invalid-transition' })
    const settled = await supervisor.list()
    expect(settled[0]?.status).toBe('failed')
  })

  it('marks tasks interrupted at startup when the predecessor died running', async () => {
    const { supervisor, registryPath } = await boot(async (registryPath) => {
      const stale: unknown = {
        version: 1,
        tasks: [{ taskId: 'task-lost', sessionId: 's1', title: 'Пропавшая', status: 'running', updatedAt: 1 }],
      }
      await writeFile(registryPath, JSON.stringify(stale, null, 2), 'utf8')
    })
    const listed = await supervisor.list()
    expect(listed[0]?.status).toBe('interrupted')
    const disk = await readRegistry(registryPath)
    expect(disk.tasks[0]?.status).toBe('interrupted')
  })

  it('parks every running task before teardown and refuses later mutations', async () => {
    const { supervisor, registryPath } = await boot()
    const task = await supervisor.track({ sessionId: SessionId('s1'), title: 'Долгая работа' })
    await context?.fiber.dispose()
    const disk = await readRegistry(registryPath)
    expect(disk.tasks[0]?.status).toBe('paused')
    await expect(supervisor.track({ sessionId: SessionId('s2'), title: 'Поздно' }))
      .rejects.toMatchObject({ code: 'stopping' })
    expect(task.status).toBe('running')
  })

  it('reports a missing agent registry as an unavailable resume path', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-task-supervisor-'))
    const registryPath = join(root, 'task-registry.json')
    context = new Context()
    await context.plugin(TaskSupervisor, { registryPath }).await()
    const task = await context.taskSupervisor.track({ sessionId: SessionId('s1'), title: 'Работа' })
    await context.fiber.dispose()
    context = new Context()
    await context.plugin(TaskSupervisor, { registryPath }).await()
    await expect(context.taskSupervisor.resume(task.taskId))
      .rejects.toMatchObject({ code: 'resume-unavailable' })
    expect((await context.taskSupervisor.list())[0]?.status).toBe('paused')
  })

  it('reverts a failed resume to the parked status when persistence is absent', async () => {
    const { supervisor } = await boot()
    const task = await supervisor.track({ sessionId: SessionId('s1'), title: 'Работа' })
    await context?.fiber.dispose()
    context = new Context()
    await context.plugin(AgentRegistry)
    const registryPath = join(root as string, 'task-registry.json')
    await context.plugin(TaskSupervisor, { registryPath }).await()
    // No agent loop is mounted, so the parked task stays parked…
    expect((await context.taskSupervisor.list())[0]?.status).toBe('paused')
    // …and an explicit resume fails loud and reverts.
    await expect(context.taskSupervisor.resume(task.taskId)).rejects.toBeInstanceOf(TaskSupervisorError)
    expect((await context.taskSupervisor.list())[0]?.status).toBe('paused')
  })
})
