import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  TaskId,
  REGISTRY_FORMAT_VERSION,
  RegistryFileError,
  TaskRegistryStore,
  parseRegistryDocument,
  replaceWithRetry,
  serializeRegistryDocument,
} from '../src/registry.ts'
import type { TaskRecord } from '../src/types.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** A fake clock: every call returns the next tick of a fixed schedule. */
function fakeClock(ticks: number[]): () => number {
  let index = 0
  return () => ticks[Math.min(index++, ticks.length - 1)] as number
}

async function storeAtPath(name: string, now?: () => number): Promise<{ store: TaskRegistryStore; path: string }> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-task-registry-'))
  const path = join(root, name)
  return { store: new TaskRegistryStore({ filePath: path, ...(now === undefined ? {} : { now }) }), path }
}

describe('parseRegistryDocument', () => {
  it('round-trips records through the serialized document', () => {
    const records: TaskRecord[] = [{
      taskId: TaskId('task-1'),
      sessionId: SessionId('session-1'),
      title: 'Перенести отчёты',
      status: 'paused',
      updatedAt: 42,
    }]
    const text = serializeRegistryDocument(records)
    expect(text.endsWith('\n')).toBe(true)
    expect(parseRegistryDocument(text, 'task-registry.json')).toEqual(records)
  })

  it('rejects malformed documents with a RegistryFileError naming the file', () => {
    const cases: [string, RegExp][] = [
      ['not json at all', /not valid JSON/],
      ['[]', /not a task registry document/],
      ['{"version": 2, "tasks": []}', /expected version 1/],
      ['{"version": 1}', /tasks must be an array/],
      ['{"version": 1, "tasks": [42]}', /tasks\[0\] is not a record/],
      ['{"version": 1, "tasks": [{}]}', /tasks\[0\] lacks "taskId"/],
      ['{"version": 1, "tasks": [{"taskId": "t", "sessionId": "", "title": "x", "status": "running", "updatedAt": 1}]}', /malformed identity/],
      ['{"version": 1, "tasks": [{"taskId": "t", "sessionId": "s", "title": "x", "status": "flying", "updatedAt": 1}]}', /unknown status/],
      ['{"version": 1, "tasks": [{"taskId": "t", "sessionId": "s", "title": "x", "status": "running", "updatedAt": 1.5}]}', /non-integer updatedAt/],
    ]
    for (const [text, expected] of cases) {
      expect(() => parseRegistryDocument(text, 'reg.json')).toThrow(RegistryFileError)
      expect(() => parseRegistryDocument(text, 'reg.json')).toThrow(expected)
      try {
        parseRegistryDocument(text, 'reg.json')
      } catch (error) {
        expect((error as RegistryFileError).message).toContain('reg.json')
      }
    }
  })
})

describe('TaskRegistryStore', () => {
  it('treats an absent document as the empty registry', async () => {
    const { store } = await storeAtPath('absent.json')
    await store.load()
    expect(store.snapshot()).toEqual([])
  })

  it('fails the load loud on a corrupt document', async () => {
    const { store, path } = await storeAtPath('broken.json')
    await writeFile(path, '{"version": 9}', 'utf8')
    await expect(store.load()).rejects.toThrow(RegistryFileError)
  })

  it('re-raises non-ENOENT read failures instead of treating them as absence', async () => {
    root ??= await mkdtemp(join(tmpdir(), 'dsh-task-registry-'))
    // A directory where the document belongs: readFile fails with EISDIR,
    // which is a real failure, not absence.
    const probe = new TaskRegistryStore({ filePath: root })
    await expect(probe.load()).rejects.toThrow()
  })

  it('tracks a session with a fresh branded task id and stamps the fake clock', async () => {
    const { store, path } = await storeAtPath('reg.json', fakeClock([100, 200, 300]))
    await store.load()
    const { record, created } = await store.upsertRunning({ sessionId: SessionId('s1'), title: 'Работа' })
    expect(created).toBe(true)
    expect(record.status).toBe('running')
    expect(record.updatedAt).toBe(100)
    expect(record.taskId).toMatch(/^task-/)
    const disk = JSON.parse(await readFile(path, 'utf8')) as { version: number; tasks: TaskRecord[] }
    expect(disk.version).toBe(REGISTRY_FORMAT_VERSION)
    expect(disk.tasks).toHaveLength(1)
    expect(disk.tasks[0]?.taskId).toBe(record.taskId)
  })

  it('is idempotent by session id: an identical retrack commits nothing', async () => {
    const { store, path } = await storeAtPath('reg.json', fakeClock([100, 200, 300, 400]))
    await store.load()
    const first = await store.upsertRunning({ sessionId: SessionId('s1'), title: 'Работа' })
    const before = await readFile(path, 'utf8')
    const second = await store.upsertRunning({ sessionId: SessionId('s1'), title: 'Работа' })
    expect(second.created).toBe(false)
    expect(second.record).toEqual(first.record)
    expect(await readFile(path, 'utf8')).toBe(before)
  })

  it('retitles the active record and flips a parked one back to running', async () => {
    const { store } = await storeAtPath('reg.json', fakeClock([100, 200, 300, 400, 500]))
    await store.load()
    const first = await store.upsertRunning({ sessionId: SessionId('s1'), title: 'Работа' })
    await store.transition(first.record.taskId, 'paused')
    const retitled = await store.upsertRunning({ sessionId: SessionId('s1'), title: 'Другая работа' })
    expect(retitled.created).toBe(false)
    expect(retitled.record.taskId).toBe(first.record.taskId)
    expect(retitled.record.status).toBe('running')
    expect(retitled.record.title).toBe('Другая работа')
  })

  it('opens a fresh task identity when the session has only terminal history', async () => {
    const { store } = await storeAtPath('reg.json', fakeClock([100, 200, 300, 400]))
    await store.load()
    const first = await store.upsertRunning({ sessionId: SessionId('s1'), title: 'Работа' })
    await store.transition(first.record.taskId, 'completed')
    const second = await store.upsertRunning({ sessionId: SessionId('s1'), title: 'Работа' })
    expect(second.created).toBe(true)
    expect(second.record.taskId).not.toBe(first.record.taskId)
    expect(store.snapshot()).toHaveLength(2)
  })

  it('walks the closed transition table and rejects unknown tasks', async () => {
    const { store } = await storeAtPath('reg.json', fakeClock([100, 200, 300, 400]))
    await store.load()
    const { record } = await store.upsertRunning({ sessionId: SessionId('s1'), title: 'Работа' })
    await expect(store.transition(record.taskId, 'running')).rejects.toThrow(/from "running" to "running"/)
    await expect(store.transition('task-nope' as never, 'completed')).rejects.toThrow(/is not tracked/)
    await store.transition(record.taskId, 'paused')
    await store.transition(record.taskId, 'completed')
    await expect(store.transition(record.taskId, 'running')).rejects.toThrow(/from "completed"/)
    expect(store.get(record.taskId)?.status).toBe('completed')
  })

  it('flips every running record in one write and leaves the rest untouched', async () => {
    const { store, path } = await storeAtPath('reg.json', fakeClock([100, 200, 300, 400, 500, 600]))
    await store.load()
    const a = await store.upsertRunning({ sessionId: SessionId('s1'), title: 'A' })
    const b = await store.upsertRunning({ sessionId: SessionId('s2'), title: 'B' })
    await store.transition(a.record.taskId, 'completed')
    const flipped = await store.flipRunning('paused')
    expect(flipped.map(record => record.taskId)).toEqual([b.record.taskId])
    expect(flipped[0]?.status).toBe('paused')
    const disk = JSON.parse(await readFile(path, 'utf8')) as { tasks: TaskRecord[] }
    expect(disk.tasks.find(task => task.taskId === a.record.taskId)?.status).toBe('completed')
    expect(disk.tasks.find(task => task.taskId === b.record.taskId)?.status).toBe('paused')
  })

  it('skips the commit when nothing is running', async () => {
    const { store, path } = await storeAtPath('reg.json')
    await store.load()
    expect(await store.flipRunning('paused')).toEqual([])
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('merges with a foreign document by task id instead of clobbering it', async () => {
    const { store: mine, path } = await storeAtPath('shared.json', fakeClock([100, 200]))
    await mine.load()
    const foreign = new TaskRegistryStore({ filePath: path, now: fakeClock([300, 400]) })
    await foreign.load()
    const a = await mine.upsertRunning({ sessionId: SessionId('s1'), title: 'Моя' })
    const b = await foreign.upsertRunning({ sessionId: SessionId('s2'), title: 'Чужая' })
    const disk = JSON.parse(await readFile(path, 'utf8')) as { tasks: TaskRecord[] }
    expect(disk.tasks.map(task => task.taskId).sort()).toEqual([a.record.taskId, b.record.taskId].sort())
  })

  it('fails a commit loud when the on-disk document turned corrupt', async () => {
    const { store, path } = await storeAtPath('reg.json', fakeClock([100, 200]))
    await store.load()
    await store.upsertRunning({ sessionId: SessionId('s1'), title: 'Работа' })
    await writeFile(path, 'garbage{', 'utf8')
    // The next mutation surfaces the foreign corruption instead of overwriting it.
    await expect(store.upsertRunning({ sessionId: SessionId('s2'), title: 'Вторая' }))
      .rejects.toThrow(RegistryFileError)
  })
})
describe('replaceWithRetry', () => {
  const file = 'reg.json'

  /** The injectable atomic-replace primitive of {@link replaceWithRetry}. */
  type Replace = NonNullable<Parameters<typeof replaceWithRetry>[2]>

  /** A replace stub denying with the given errors before succeeding. */
  function denialStub(denials: NodeJS.ErrnoException[]): { replace: Replace; calls: () => number } {
    let calls = 0
    const replace = (async () => {
      const denial = denials[calls]
      calls += 1
      if (denial !== undefined) throw denial
    }) as Replace
    return { replace, calls: () => calls }
  }

  it('succeeds after transient rename denials', async () => {
    const { replace, calls } = denialStub([
      Object.assign(new Error('denied'), { code: 'EPERM' }),
      Object.assign(new Error('busy'), { code: 'EBUSY' }),
    ])
    await replaceWithRetry(file, '{}', replace)
    expect(calls()).toBe(3)
  })

  it('fails loud on a non-transient error without retrying', async () => {
    const { replace, calls } = denialStub([Object.assign(new Error('gone'), { code: 'ENOENT' })])
    await expect(replaceWithRetry(file, '{}', replace)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(calls()).toBe(1)
  })

  it('fails loud at the deadline when the denial stands', async () => {
    const denial = Object.assign(new Error('denied'), { code: 'EPERM' })
    const { replace, calls } = denialStub(Array.from({ length: 512 }, () => denial))
    await expect(replaceWithRetry(file, '{}', replace)).rejects.toMatchObject({ code: 'EPERM' })
    expect(calls()).toBeGreaterThan(1)
  }, 10_000)
})

describe('TaskRegistryStore rollback', () => {
  it('rolls the memory side back when a transition commit fails', async () => {
    const { store, path } = await storeAtPath('reg.json', fakeClock([100, 200]))
    await store.load()
    const { record } = await store.upsertRunning({ sessionId: SessionId('s1'), title: 'Работа' })
    await writeFile(path, 'garbage{', 'utf8')
    await expect(store.transition(record.taskId, 'paused')).rejects.toThrow(RegistryFileError)
    expect(store.get(record.taskId)?.status).toBe('running')
  })

  it('rolls the whole flip back when its commit fails', async () => {
    const { store, path } = await storeAtPath('reg.json', fakeClock([100, 200]))
    await store.load()
    await store.upsertRunning({ sessionId: SessionId('s1'), title: 'A' })
    await writeFile(path, 'garbage{', 'utf8')
    await expect(store.flipRunning('paused')).rejects.toThrow(RegistryFileError)
    expect(store.snapshot().every(record => record.status === 'running')).toBe(true)
  })
})

