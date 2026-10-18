/**
 * Task-supervisor value types: statuses, the durable record, and the branded
 * cross-boundary task identity.
 * @module @deepseek-ai/dsh-task-supervisor/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { StationId } from '@deepseek-ai/dsh-station-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'

export type { StationId } from '@deepseek-ai/dsh-station-protocol'

/** Opaque cross-boundary task identity; minted only by the owning supervisor. */
export type TaskId = Branded<'TaskId'>

/** Lifecycle status of one tracked task, as stored and as served. */
export type TaskStatus =
  /** Work is (or claims to be) in progress in a live process. */
  | 'running'
  /** A clean supervisor unload parked the task; the next start resumes it. */
  | 'paused'
  /** The previous process died without parking the task (hard crash). */
  | 'interrupted'
  /** The bound execution station is offline; the station/status online event resumes the task. */
  | 'waiting-station'
  /** The owner reported success. */
  | 'completed'
  /** The owner reported failure. */
  | 'failed'

/**
 * One durable registry record. The on-disk document holds exactly these
 * fields per task; a failure reason travels through the log, not the file.
 */
export interface TaskRecord {
  /** Branded opaque task identity, stable across restarts. */
  readonly taskId: TaskId
  /** The session whose agent performs (or performed) the work. */
  readonly sessionId: SessionId
  /** Caller-supplied human-readable task label. */
  readonly title: string
  /** Current lifecycle status. */
  readonly status: TaskStatus
  /** Epoch milliseconds of the last durable status or title change. */
  readonly updatedAt: number
  /**
   * The execution station the work is bound to, when any. Absent for tasks
   * that run in the host's own execution world; present, the supervisor moves
   * running records to `waiting-station` when that station drops offline and
   * auto-resumes them when it reconnects.
   */
  readonly stationId?: StationId
}

/** Detached view served by the service API; values are fresh copies. */
export type TaskView = TaskRecord
