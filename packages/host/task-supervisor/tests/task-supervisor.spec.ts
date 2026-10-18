import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { StationId } from '@deepseek-ai/dsh-station-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import TaskSupervisor, {
  CONTINUATION_PROMPT,
  STATION_CONTINUATION_PROMPT,
  buildContinuationMessage,
  buildStationContinuationMessage,
  TaskSupervisorError,
} from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface Harness { supervisor: TaskSupervisor; registryPath: string; stations: { online: Map<string, boolean> } }

/**
 * Boot one supervisor over a fresh temporary registry. The stations bridge is
 * a stub keyed by its `isOnline` map — the seam face the supervisor reads
 * (the `station/status` event rides the real cordis dispatch).
 */
async function boot(configure?: (registryPath: string) => Promise<void>): Promise<Harness> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-task-supervisor-'))
  const registryPath = join(root, 'task-registry.json')
  await configure?.(registryPath)
  context = new Context()
  const stations = { online: new Map<string, boolean>() }
  context.provide('stations', {
    isOnline: (stationId: StationId) => stations.online.get(String(stationId)) === true,
  } as never)
  await context.plugin(AgentRegistry)
  const fiber = context.plugin(TaskSupervisor, { registryPath })
  await fiber.await()
  return { supervisor: context.taskSupervisor, registryPath, stations }
}

/** Register a live agent double the supervisor reuses instead of a cold open. */
function attachAgent(sessionId: SessionId, status: 'idle' | 'running' = 'idle'): { agent: Agent; followups: unknown[] } {
  const followups: unknown[] = []
  const agent = {
    id: sessionId,
    status,
    session: { id: sessionId },
    followup: (message: unknown) => { followups.push(message) },
  } as unknown as Agent
  context?.agents.register(agent)
  return { agent, followups }
}

/** One station/status transition through the real cordis dispatch. */
function emitStationStatus(stationId: StationId, online: boolean): void {
  context?.emit('station/status', { stationId, online })
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
  const parsed: unknown = JSON.parse(await readFile(registryPath, 'utf8'))
  return parsed as { tasks: DiskTask[] }
}

describe('CONTINUATION_PROMPT', () => {
  it('pins the model-visible continuation literal verbatim', () => {
    expect(CONTINUATION_PROMPT).toMatchInlineSnapshot(
      '"Задача была прервана рестартом сервера. Продолжи выполнение с места остановки; сначала кратко восстанови контекст по истории."',
    )
    expect(STATION_CONTINUATION_PROMPT).toMatchInlineSnapshot(
      '"Связь со станцией восстановлена. Продолжи выполнение задачи с места остановки."',
    )
  })

  it('rides the ordinary logged user input path with the plugin source', () => {
    const message = buildContinuationMessage()
    expect(message.role).toBe('user')
    expect(message.source).toEqual({ kind: 'plugin', plugin: '@deepseek-ai/dsh-task-supervisor' })
    expect(message.content).toEqual([{ type: 'text', text: CONTINUATION_PROMPT }])
    const station = buildStationContinuationMessage()
    expect(station.role).toBe('user')
    expect(station.source).toEqual({ kind: 'plugin', plugin: '@deepseek-ai/dsh-task-supervisor' })
    expect(station.content).toEqual([{ type: 'text', text: STATION_CONTINUATION_PROMPT }])
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

  it('persists the station binding through track', async () => {
    const { supervisor, registryPath } = await boot()
    await supervisor.track({
      sessionId: SessionId('s1'),
      title: 'На станции',
      stationId: StationId('stn-1'),
    })
    const disk = await readRegistry(registryPath)
    expect(disk.tasks[0]).toMatchObject({ sessionId: 's1', stationId: 'stn-1', status: 'running' })
  })

  it('parks a bound running task as waiting-station when its station goes offline', async () => {
    const { supervisor, registryPath } = await boot()
    const bound = await supervisor.track({
      sessionId: SessionId('s1'), title: 'На станции', stationId: StationId('stn-1'),
    })
    const other = await supervisor.track({
      sessionId: SessionId('s2'), title: 'Другая станция', stationId: StationId('stn-2'),
    })
    const local = await supervisor.track({ sessionId: SessionId('s3'), title: 'Локальная' })
    emitStationStatus(StationId('stn-1'), false)
    // The durable park is the commit point: wait for the disk, not the memory.
    await vi.waitFor(async () => {
      const disk = await readRegistry(registryPath)
      expect(disk.tasks.find(task => task.taskId === bound.taskId)?.status).toBe('waiting-station')
    }, { timeout: 2_000, interval: 10 })
    // Only the offline station's running records move.
    expect((await supervisor.list()).find(task => task.taskId === other.taskId)?.status).toBe('running')
    expect((await supervisor.list()).find(task => task.taskId === local.taskId)?.status).toBe('running')
  })

  it('auto-resumes a waiting-station task when its station returns, with the station wording', async () => {
    const { supervisor, registryPath } = await boot()
    const task = await supervisor.track({
      sessionId: SessionId('s1'), title: 'На станции', stationId: StationId('stn-1'),
    })
    const { followups } = attachAgent(SessionId('s1'))
    emitStationStatus(StationId('stn-1'), false)
    // Both waits target the durable commit, not the pre-commit memory state.
    await vi.waitFor(async () => {
      const disk = await readRegistry(registryPath)
      expect(disk.tasks[0]?.status).toBe('waiting-station')
    }, { timeout: 2_000, interval: 10 })
    emitStationStatus(StationId('stn-1'), true)
    await vi.waitFor(async () => {
      const disk = await readRegistry(registryPath)
      expect(disk.tasks[0]?.status).toBe('running')
    }, { timeout: 2_000, interval: 10 })
    // The follow-up lands in the microtask chain right after the transition
    // commit the disk wait just observed.
    for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve))
    // The idle agent's continuation carries the station-return text, not the
    // restart text: the work continues on the reconnected bridge.
    expect(followups).toHaveLength(1)
    expect(followups[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: STATION_CONTINUATION_PROMPT }],
      source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-task-supervisor' },
    })
    expect(task.stationId).toBe(StationId('stn-1'))
  })

  it('skips the continuation input when the resumed turn is still in flight', async () => {
    const { supervisor, registryPath } = await boot()
    await supervisor.track({
      sessionId: SessionId('s1'), title: 'На станции', stationId: StationId('stn-1'),
    })
    // The turn never stopped across the offline window: the resume must not
    // queue a follow-up behind the live turn.
    const { followups } = attachAgent(SessionId('s1'), 'running')
    emitStationStatus(StationId('stn-1'), false)
    await vi.waitFor(async () => {
      const disk = await readRegistry(registryPath)
      expect(disk.tasks[0]?.status).toBe('waiting-station')
    }, { timeout: 2_000, interval: 10 })
    emitStationStatus(StationId('stn-1'), true)
    await vi.waitFor(async () => {
      const disk = await readRegistry(registryPath)
      expect(disk.tasks[0]?.status).toBe('running')
    }, { timeout: 2_000, interval: 10 })
    for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve))
    expect(followups).toHaveLength(0)
  })

  it('resumes a waiting-station task explicitly and keeps the wait across teardown', async () => {
    const { supervisor, registryPath } = await boot()
    const task = await supervisor.track({
      sessionId: SessionId('s1'), title: 'На станции', stationId: StationId('stn-1'),
    })
    emitStationStatus(StationId('stn-1'), false)
    await vi.waitFor(async () => {
      const disk = await readRegistry(registryPath)
      expect(disk.tasks[0]?.status).toBe('waiting-station')
    }, { timeout: 2_000, interval: 10 })
    // Explicit resume follows the same mechanics with the always-deliver rule.
    const { followups } = attachAgent(SessionId('s1'))
    const resumed = await supervisor.resume(task.taskId)
    expect(resumed.status).toBe('running')
    expect(followups).toHaveLength(1)
    // The clean unload parks running tasks; a station wait is not a park —
    // the offline window survives the restart.
    emitStationStatus(StationId('stn-1'), false)
    await vi.waitFor(async () => {
      const disk = await readRegistry(registryPath)
      expect(disk.tasks.find(entry => entry.taskId === task.taskId)?.status).toBe('waiting-station')
    }, { timeout: 2_000, interval: 10 })
    await context?.fiber.dispose()
    const disk = await readRegistry(registryPath)
    expect(disk.tasks.find(entry => entry.taskId === task.taskId)?.status).toBe('waiting-station')
  })
})
