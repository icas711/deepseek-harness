/**
 * Durable task registry: the `task-registry.json` document, its strict
 * boundary parse, and the in-process store. Every mutation re-renders the
 * whole document and commits it through the atomic-write writer lock, so
 * readers observe only complete old or complete new content and concurrent
 * processes merge instead of clobbering each other.
 * @module @deepseek-ai/dsh-task-supervisor/registry
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { StationId } from '@deepseek-ai/dsh-station-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TaskSupervisorError } from './task-error.ts'
import type { TaskId, TaskRecord, TaskStatus } from './types.ts'

/** Brand a string as a {@link TaskId}.
 * @param value - the raw task id string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function TaskId(value: string): TaskId {
  return value as TaskId
}

/** On-disk format version, stamped into every document and enforced on load. */
export const REGISTRY_FORMAT_VERSION = 1

/** Every status the format admits; the parse rejects anything else. */
const TASK_STATUSES: readonly TaskStatus[] = ['running', 'paused', 'interrupted', 'waiting-station', 'completed', 'failed']

/**
 * The closed transition table. `running -> interrupted` is the startup flip for
 * a predecessor process that died without parking, and the revert a failed
 * resume takes; `running -> paused` is the clean-unload flip;
 * `running -> waiting-station` and `waiting-station -> running` are the
 * station-driven pair (the bound station dropped offline, then reconnected);
 * terminal statuses accept nothing.
 */
const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  running: ['paused', 'interrupted', 'waiting-station', 'completed', 'failed'],
  paused: ['running', 'completed', 'failed'],
  interrupted: ['running', 'completed', 'failed'],
  'waiting-station': ['running', 'completed', 'failed'],
  completed: [],
  failed: [],
}

/** Statuses that claim live, parked, or station-blocked work; at most one per session id. */
const ACTIVE_STATUSES: readonly TaskStatus[] = ['running', 'paused', 'interrupted', 'waiting-station']

/** Whether a filesystem error means absence; every other failure surfaces. */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * The registry document failed its boundary parse. Rendered as a boot failure
 * with operator guidance: a corrupt durable registry must fail loud, never be
 * silently ignored or overwritten.
 */
export class RegistryFileError extends Error {
  /**
   * Construct one parse failure.
   * @param filePath - the document that failed to parse.
   * @param reason - the concrete validation failure.
   */
  constructor(filePath: string, reason: string) {
    super(`task-supervisor: cannot read the task registry "${filePath}" (${reason}); `
      + 'fix or delete the file — deleting it abandons every tracked task')
    this.name = 'RegistryFileError'
  }
}

/** On-disk document shape. */
interface RegistryDocument {
  version: typeof REGISTRY_FORMAT_VERSION
  tasks: TaskRecord[]
}

/**
 * Parse one registry document at the durable boundary. Every field is
 * validated; unknown statuses, non-records, and a foreign version fail loud.
 * @param text - complete file content.
 * @param filePath - the document path, named in failures.
 * @returns the parsed task records.
 * @throws {@link RegistryFileError} on any structural violation.
 */
export function parseRegistryDocument(text: string, filePath: string): TaskRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new RegistryFileError(filePath, `not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RegistryFileError(filePath, 'not a task registry document')
  }
  const doc = parsed as { version?: unknown; tasks?: unknown }
  if (doc.version !== REGISTRY_FORMAT_VERSION) {
    throw new RegistryFileError(filePath, `expected version ${REGISTRY_FORMAT_VERSION}, got ${String(doc.version)}`)
  }
  if (!Array.isArray(doc.tasks)) {
    throw new RegistryFileError(filePath, 'tasks must be an array')
  }
  return doc.tasks.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new RegistryFileError(filePath, `tasks[${index}] is not a record`)
    }
    const record = entry as { taskId?: unknown; sessionId?: unknown; title?: unknown; status?: unknown; updatedAt?: unknown; stationId?: unknown }
    for (const field of ['taskId', 'sessionId', 'title', 'status', 'updatedAt'] as const) {
      if (record[field] === undefined) {
        throw new RegistryFileError(filePath, `tasks[${index}] lacks "${field}"`)
      }
    }
    if (typeof record.taskId !== 'string' || record.taskId === ''
      || typeof record.sessionId !== 'string' || record.sessionId === ''
      || typeof record.title !== 'string') {
      throw new RegistryFileError(filePath, `tasks[${index}] carries malformed identity fields`)
    }
    if (!TASK_STATUSES.includes(record.status as TaskStatus)) {
      throw new RegistryFileError(filePath, `tasks[${index}] carries unknown status ${JSON.stringify(record.status)}`)
    }
    if (typeof record.updatedAt !== 'number' || !Number.isSafeInteger(record.updatedAt)) {
      throw new RegistryFileError(filePath, `tasks[${index}] carries a non-integer updatedAt`)
    }
    // Optional field: a task may run in the host's own execution world. When
    // present it must be a well-formed station identity — garbage fails the
    // load loud, same as any other boundary violation.
    let stationId: TaskRecord['stationId']
    if (record.stationId !== undefined) {
      if (typeof record.stationId !== 'string' || record.stationId === '') {
        throw new RegistryFileError(filePath, `tasks[${index}] carries a malformed stationId`)
      }
      stationId = StationId(record.stationId)
    }
    return {
      taskId: TaskId(record.taskId),
      sessionId: SessionId(record.sessionId),
      title: record.title,
      status: record.status as TaskStatus,
      updatedAt: record.updatedAt,
      ...(stationId === undefined ? {} : { stationId }),
    }
  })
}

/**
 * Render the complete next document. Two-space indentation keeps the file
 * human-diffable; the trailing newline matches the repository file gate.
 * @param tasks - every record in the store's order.
 * @returns the complete file content to commit.
 */
export function serializeRegistryDocument(tasks: readonly TaskRecord[]): string {
  const doc: RegistryDocument = { version: REGISTRY_FORMAT_VERSION, tasks: [...tasks] }
  return `${JSON.stringify(doc, null, 2)}\n`
}

/**
 * Replace-retry protocol constants. These are robustness invariants of the
 * durable write, not deployment tunables: a scanner or indexer that briefly
 * holds the freshly replaced file open denies the next rename with
 * `EPERM`/`EBUSY` on Windows, and restart-window writes land exactly inside
 * that window; the bounded backoff keeps them durable without masking a real
 * denial past the deadline.
 */
const REPLACE_RETRY_INITIAL_MS = 25
const REPLACE_RETRY_MAX_MS = 200
const REPLACE_RETRY_DEADLINE_MS = 2_000

/** Whether a filesystem denial is the transient replace-denied class. */
function isReplaceDenial(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

/**
 * Replace `filename` with `content`, retrying the transient rename denials a
 * restart window produces. Any other failure, or a denial still standing at
 * the deadline, fails loud.
 * @param filename - final path receiving the content.
 * @param content - complete next file content.
 * @param replace - the atomic replace primitive; injected only by tests.
 */
export async function replaceWithRetry(
  filename: string,
  content: string,
  replace: typeof writeFileAtomic = writeFileAtomic,
): Promise<void> {
  const deadline = Date.now() + REPLACE_RETRY_DEADLINE_MS
  let delay = REPLACE_RETRY_INITIAL_MS
  for (;;) {
    try {
      // 0600/0700: the dsh home holds user-private documents (session ids, titles).
      await replace(filename, content, { mode: 0o600, dirMode: 0o700 })
      return
    } catch (error) {
      if (!isReplaceDenial(error) || Date.now() >= deadline) throw error
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, REPLACE_RETRY_MAX_MS)
  }
}

/** Construction options of the store; `now` exists for tests' fake clocks. */
export interface TaskRegistryStoreOptions {
  /** Registry document path (a dsh-home path in compositions). */
  readonly filePath: string
  /** Wall-clock source for `updatedAt`; defaults to `Date.now`. */
  readonly now?: () => number
}

/**
 * The in-process authority over task records, mirrored to the durable
 * document. Memory leads: every mutation applies to the map first and then
 * commits a whole-document write that folds in any on-disk records this
 * process has not observed, so a second process sharing the home merges by
 * task id instead of erasing foreign tasks.
 */
export class TaskRegistryStore {
  private readonly records = new Map<TaskId, TaskRecord>()
  private readonly filePath: string
  private readonly now: () => number

  /**
   * Construct the store without touching the file; {@link load} reads it.
   * @param options - document path and the optional clock.
   */
  constructor(options: TaskRegistryStoreOptions) {
    this.filePath = options.filePath
    this.now = options.now ?? Date.now
  }

  /**
   * Read the durable document into memory. An absent file is the empty
   * registry; a present-but-invalid document throws — the caller fails the
   * boot loud rather than dropping tracked tasks.
   * @throws {@link RegistryFileError} when the document exists and is invalid.
   */
  async load(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (!isENOENT(error)) throw error
      return
    }
    for (const record of parseRegistryDocument(text, this.filePath)) {
      this.records.set(record.taskId, record)
    }
  }

  /** @returns fresh copies of every record, in insertion order. */
  snapshot(): TaskRecord[] {
    return [...this.records.values()].map(record => ({ ...record }))
  }

  /**
   * @param taskId - the task to read.
   * @returns a fresh copy of the record, or `undefined` when unknown.
   */
  get(taskId: TaskId): TaskRecord | undefined {
    const record = this.records.get(taskId)
    return record === undefined ? undefined : { ...record }
  }

  /**
   * @param sessionId - the session to look up.
   * @returns the session's single active (running/paused/interrupted) record,
   * or `undefined` when the session has only terminal history or nothing.
   */
  findActiveBySession(sessionId: SessionId): TaskRecord | undefined {
    for (const record of this.records.values()) {
      if (record.sessionId === sessionId && ACTIVE_STATUSES.includes(record.status)) {
        return { ...record }
      }
    }
    return undefined
  }

  /**
   * Track work: create the session's active record or retarget the existing
   * one. Idempotent by session id — a repeated identical call for an already
   * running task commits nothing. An explicit station binding rebinds the
   * record; an omitted one keeps the previous binding.
   * @param input - the session whose agent performs the work, its label, and
   *   the optional execution station the work is bound to.
   * @returns the up-to-date record and whether this call created it.
   */
  async upsertRunning(input: { sessionId: SessionId; title: string; stationId?: TaskRecord['stationId'] }): Promise<{ record: TaskRecord; created: boolean }> {
    const existing = this.findActiveBySession(input.sessionId)
    if (existing !== undefined) {
      const stationId = input.stationId ?? existing.stationId
      if (existing.status === 'running' && existing.title === input.title && existing.stationId === stationId) {
        return { record: existing, created: false }
      }
      const record: TaskRecord = {
        ...existing,
        title: input.title,
        status: 'running',
        updatedAt: this.now(),
        ...(stationId === undefined ? {} : { stationId }),
      }
      await this.settle(record.taskId, record)
      return { record: { ...record }, created: false }
    }
    const record: TaskRecord = {
      taskId: TaskId(`task-${randomUUID()}`),
      sessionId: input.sessionId,
      title: input.title,
      status: 'running',
      updatedAt: this.now(),
      ...(input.stationId === undefined ? {} : { stationId: input.stationId }),
    }
    await this.settle(record.taskId, record)
    return { record: { ...record }, created: true }
  }

  /**
   * Flip every running record bound to one station to `waiting-station` in a
   * single committed write — the station/status offline step. Tasks without
   * that binding, and records in any other status, stay untouched.
   * @param stationId - the station that dropped offline.
   * @returns the flipped records, empty when nothing was running on it.
   */
  async parkStationRunning(stationId: StationId): Promise<TaskRecord[]> {
    const previous = new Map<TaskId, TaskRecord>()
    const flipped: TaskRecord[] = []
    for (const record of this.records.values()) {
      if (record.status !== 'running' || record.stationId !== stationId) continue
      const next: TaskRecord = { ...record, status: 'waiting-station', updatedAt: this.now() }
      previous.set(record.taskId, record)
      this.records.set(record.taskId, next)
      flipped.push({ ...next })
    }
    if (flipped.length > 0) {
      try {
        await this.commit()
      } catch (error) {
        for (const [taskId, record] of previous) this.records.set(taskId, record)
        throw error
      }
    }
    return flipped
  }

  /**
   * Move one task to another status through the closed transition table.
   * @param taskId - the task to transition.
   * @param status - the target status.
   * @returns the committed record.
   * @throws {@link TaskSupervisorError} with `unknown-task` or `invalid-transition`.
   */
  async transition(taskId: TaskId, status: TaskStatus): Promise<TaskRecord> {
    const current = this.records.get(taskId)
    if (current === undefined) {
      throw new TaskSupervisorError(`task "${taskId}" is not tracked`, 'unknown-task')
    }
    if (!ALLOWED_TRANSITIONS[current.status].includes(status)) {
      throw new TaskSupervisorError(
        `cannot move task "${taskId}" from "${current.status}" to "${status}"`,
        'invalid-transition',
      )
    }
    const record: TaskRecord = { ...current, status, updatedAt: this.now() }
    await this.settle(taskId, record)
    return { ...record }
  }

  /**
   * Flip every running record to one target of the startup/unload pair in a
   * single committed write — the atomic soft-restart step. Tasks already
   * parked or terminal stay untouched.
   * @param status - `paused` for a clean unload, `interrupted` after a hard crash.
   * @returns the flipped records, empty when nothing was running.
   */
  async flipRunning(status: 'paused' | 'interrupted'): Promise<TaskRecord[]> {
    const previous = new Map<TaskId, TaskRecord>()
    const flipped: TaskRecord[] = []
    for (const record of this.records.values()) {
      if (record.status !== 'running') continue
      const next: TaskRecord = { ...record, status, updatedAt: this.now() }
      previous.set(record.taskId, record)
      this.records.set(record.taskId, next)
      flipped.push({ ...next })
    }
    if (flipped.length > 0) {
      try {
        await this.commit()
      } catch (error) {
        for (const [taskId, record] of previous) this.records.set(taskId, record)
        throw error
      }
    }
    return flipped
  }

  /**
   * Publish one record to the map only together with its durable commit: a
   * failed write rolls the memory side back, so the store never claims a
   * status the document does not hold.
   * @param taskId - the record's task id.
   * @param record - the next record to publish.
   */
  private async settle(taskId: TaskId, record: TaskRecord): Promise<void> {
    const previous = this.records.get(taskId)
    this.records.set(taskId, record)
    try {
      await this.commit()
    } catch (error) {
      if (previous === undefined) this.records.delete(taskId)
      else this.records.set(taskId, previous)
      throw error
    }
  }

  /**
   * Commit the in-memory map as the task-id union with the on-disk document.
   * The writer lock serializes cross-process read-modify-write cycles; the
   * atomic replace keeps every reader on complete content. A foreign document
   * that fails its parse fails the write loud instead of being overwritten —
   * the same stance as {@link load}.
   */
  private async commit(): Promise<void> {
    await withFileLock(this.filePath, async () => {
      let disk: TaskRecord[]
      try {
        disk = parseRegistryDocument(await readFile(this.filePath, 'utf8'), this.filePath)
      } catch (error) {
        if (!isENOENT(error)) throw error
        disk = []
      }
      const merged = new Map<TaskId, TaskRecord>()
      for (const record of disk) merged.set(record.taskId, record)
      for (const record of this.records.values()) merged.set(record.taskId, record)
      await replaceWithRetry(this.filePath, serializeRegistryDocument([...merged.values()]))
    })
  }
}
