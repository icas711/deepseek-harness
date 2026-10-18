/**
 * Durable task supervisor (`ctx.taskSupervisor`): a home-folder task registry
 * whose running tasks survive process restarts. A clean unload parks every
 * running task (`paused`) before teardown; the next start marks tasks the
 * predecessor died on (`interrupted`) and automatically resumes parked ones
 * by reopening their sessions and delivering one continuation message
 * through the ordinary logged input path.
 * @module @deepseek-ai/dsh-task-supervisor
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type { StationId } from '@deepseek-ai/dsh-station-protocol'
// Side-effect type imports: resolve the optional stations composition — the
// `ctx.get('stations')` read, the `station/status` event, and the station
// world the resume mounts (`stationWorldSetup`).
import type {} from '@deepseek-ai/dsh-stations'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { TaskRegistryStore } from './registry.ts'
import { buildContinuationMessage, buildStationContinuationMessage, openSessionAgent } from './resume.ts'
import { TaskSupervisorError } from './task-error.ts'
import type { TaskId, TaskRecord, TaskView } from './types.ts'

export type { StationId, TaskId, TaskRecord, TaskStatus, TaskView } from './types.ts'
export { TaskSupervisorError } from './task-error.ts'
export {
  CONTINUATION_PROMPT,
  STATION_CONTINUATION_PROMPT,
  buildContinuationMessage,
  buildStationContinuationMessage,
  stationWorldSetup,
} from './resume.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable cross-restart task supervisor. */
    taskSupervisor: TaskSupervisor
  }
}

/** Plugin configuration: composition-supplied deployment settings. */
export interface Config {
  /**
   * Task registry document path. Required (no default): records carry
   * session identities and task labels, so the location is stated
   * explicitly — compositions pass `dshHomePath('task-registry.json')`.
   */
  registryPath: string
}

/** The task supervisor service (`ctx.taskSupervisor`). */
export class TaskSupervisor extends Service {
  static Config: z<Config> = z.object({
    registryPath: z.string().required(),
  })

  private readonly store: TaskRegistryStore
  /** Set before the durable pause so no mutation lands after it. */
  private stopping: boolean = false
  /** Resolves once the registry is loaded and the startup flip committed. */
  private ready: Promise<void> = Promise.resolve()
  /** In-flight resume operations, awaited by teardown before the pause. */
  private readonly resumeRuns = new Map<TaskId, Promise<unknown>>()
  /** Handles of agents this supervisor resumed; drained at teardown. */
  private readonly handles = new Map<SessionId, AgentHandle>()

  /**
   * Construct the service. Initialization runs in {@link TaskSupervisor.init}:
   * a corrupt registry document fails the fiber loud at load.
   * @param ctx - context providing the agent registry and, optionally, the
   * persistence, preset-roster, and default-model services.
   * @param config - validated {@link Config}.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'taskSupervisor')
    this.store = new TaskRegistryStore({ filePath: config.registryPath })
  }

  /**
   * Load the registry, reconcile the startup state, and register the
   * lifecycle effects: parked tasks resume once an agent factory exists, and
   * teardown parks every running task before the rest of the tree unwinds.
   */
  protected async [Service.init](): Promise<void> {
    this.ready = (async () => {
      await this.store.load()
      const interrupted = await this.store.flipRunning('interrupted')
      if (interrupted.length > 0) {
        this.ctx.logger.warn(
          `task-supervisor: the previous process died with ${interrupted.length} running task(s); `
          + `marked interrupted: ${interrupted.map(record => String(record.taskId)).join(', ')}`)
      }
    })()
    await this.ready
    this.ctx.inject(['agentLoop'], () => {
      void this.autoResumeParked()
    })
    // Registering the pause effect last keeps it the fiber's FIRST disposer:
    // the durable park write completes before anything else of this plugin
    // (or a later-mounted sibling) tears down.
    this.ctx.effect(() => async () => {
      await this.teardown()
    }, 'task-supervisor: park running tasks before teardown')
    // Station-driven lifecycle: after the pause effect, so the subscription
    // disposer never precedes the park write at teardown.
    if (this.ctx.get('stations') !== undefined) {
      this.ctx.on('station/status', ({ stationId, online }) => {
        void this.onStationStatus(stationId, online)
      })
    }
  }

  /**
   * Track work on a session. Idempotent by session id: a repeated call
   * retitles the existing active record or commits nothing when nothing
   * changed; an explicit `stationId` rebinds the record, an omitted one
   * keeps the previous binding; a session whose record is terminal
   * (completed/failed) gets a fresh task identity.
   * @param request - the session whose agent performs the work, the
   * human-readable task label, and the optional execution station the work
   * is bound to (ownership is validated by the caller — the RPC boundary).
   * @returns the up-to-date durable record.
   * @throws {@link TaskSupervisorError} with `stopping` during teardown.
   */
  async track(request: { sessionId: SessionId; title: string; stationId?: StationId }): Promise<TaskView> {
    this.assertAccepting()
    await this.ready
    const { record } = await this.store.upsertRunning(request)
    return record
  }

  /**
   * Mark a task completed.
   * @param taskId - the task to settle.
   * @returns the committed record.
   * @throws {@link TaskSupervisorError} with `unknown-task`,
   * `invalid-transition` (terminal or wrong status), or `stopping`.
   */
  async markCompleted(taskId: TaskId): Promise<TaskView> {
    this.assertAccepting()
    await this.ready
    return this.store.transition(taskId, 'completed')
  }

  /**
   * Mark a task failed and account for the reason in the log. The durable
   * record carries the fixed field set; the reason travels through the log,
   * not the registry file.
   * @param taskId - the task to settle.
   * @param reason - non-empty human-readable failure account.
   * @returns the committed record.
   * @throws {@link TaskSupervisorError} with `invalid-reason`, `unknown-task`,
   * `invalid-transition`, or `stopping`.
   */
  async markFailed(taskId: TaskId, reason: string): Promise<TaskView> {
    this.assertAccepting()
    await this.ready
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new TaskSupervisorError('markFailed requires a non-empty reason', 'invalid-reason')
    }
    const record = await this.store.transition(taskId, 'failed')
    this.ctx.logger.warn(`task-supervisor: task "${record.title}" (${String(taskId)}) marked failed: ${reason}`)
    return record
  }

  /**
   * Snapshot the whole registry for callers outside the service, such as a
   * notification watcher diffing task statuses between ticks.
   * @returns fresh copies of every record, in registry order. Safe before
   * initialization settles: the read follows {@link TaskSupervisor.ready}.
   */
  async list(): Promise<TaskView[]> {
    await this.ready
    return this.store.snapshot()
  }

  /**
   * Resume one parked, interrupted, or station-waiting task: reopen its
   * session (reusing a live agent, otherwise resuming from persistence with
   * the task's station world) and deliver the continuation message through
   * the ordinary logged input path. The automatic station-driven path uses
   * the same mechanics, skipping the input while a turn is still in flight.
   * @param taskId - the task to resume.
   * @returns the running record.
   * @throws {@link TaskSupervisorError} with `unknown-task`,
   * `invalid-transition` (already running or terminal), `stopping`,
   * `resume-unavailable`, or `session-not-found`; the record reverts to its
   * previous status when the resume itself fails.
   */
  async resume(taskId: TaskId): Promise<TaskView> {
    this.assertAccepting()
    await this.ready
    return this.resumeRun(taskId)
  }

  /** Reject mutations once teardown started parking tasks. */
  private assertAccepting(): void {
    if (this.stopping) {
      throw new TaskSupervisorError('task-supervisor is stopping; task mutations are no longer accepted', 'stopping')
    }
  }

  /**
   * Drive one task back to `running` and deliver the continuation. The
   * wording follows why the task was blocked: the restart text for
   * `paused`/`interrupted`, the station-return text for `waiting-station`.
   * A station-driven resume that finds the agent's turn still in flight adds
   * no input — the turn never stopped, and the continued step proceeds on the
   * reconnected bridge; every other resume delivers the ordinary continuation
   * message. A resume that cannot open the session or queue the message
   * reverts the record so the next start retries it.
   * @param taskId - the task to resume.
   * @param opts - `continuation: 'whenIdle'` skips the input for an
   * in-flight turn (station-driven auto-resume only); the default delivers it.
   * @returns the running record.
   */
  private async resumeRun(taskId: TaskId, opts: { continuation?: 'always' | 'whenIdle' } = {}): Promise<TaskRecord> {
    const current = this.store.get(taskId)
    if (current === undefined) {
      throw new TaskSupervisorError(`task "${String(taskId)}" is not tracked`, 'unknown-task')
    }
    const previous = current.status
    const claimed = await this.store.transition(taskId, 'running')
    const run = (async () => {
      try {
        const { agent, owned } = await openSessionAgent(this.ctx, claimed.sessionId, claimed.stationId)
        if (owned !== undefined) this.handles.set(claimed.sessionId, owned)
        if (opts.continuation === 'whenIdle' && agent.status === 'running') {
          // The turn was in flight across the whole offline window: the agent
          // continues the current step on its own, and a follow-up here would
          // queue a redundant next turn behind it.
          return
        }
        agent.followup(previous === 'waiting-station'
          ? buildStationContinuationMessage()
          : buildContinuationMessage())
      } catch (error) {
        const latest = this.store.get(taskId)
        if (latest !== undefined && latest.status === 'running') {
          await this.store.transition(taskId, previous === 'running' ? 'interrupted' : previous)
        }
        throw error
      }
    })()
    const tracked = run.finally(() => {
      this.resumeRuns.delete(taskId)
    })
    this.resumeRuns.set(taskId, tracked)
    await tracked
    return { ...claimed }
  }

  /**
   * Resume every parked task, and every `waiting-station` task whose station
   * is already online, once each — containing every failure to its task.
   * Runs when the agent factory appears; the station-online branch covers the
   * mount orders where a station connected before this service or before the
   * loop was ready.
   */
  private async autoResumeParked(): Promise<void> {
    const stations = this.ctx.get('stations')
    const parked = (await this.list()).filter(record =>
      record.status === 'paused'
      || (record.status === 'waiting-station'
        && record.stationId !== undefined
        && stations?.isOnline(record.stationId) === true))
    for (const record of parked) {
      if (this.stopping) return
      try {
        await this.resumeRun(record.taskId, { continuation: 'whenIdle' })
      } catch (error) {
        this.ctx.logger.warn(
          `task-supervisor: auto-resume of task "${record.title}" (${String(record.taskId)}) failed: `
          + (error instanceof Error ? error.message : String(error)))
      }
    }
  }

  /**
   * Apply one station/status transition to the bound tasks: offline parks
   * every running record bound to that station in one durable write; online
   * auto-resumes its `waiting-station` tasks with the
   * `whenIdle` continuation rule.
   * @param stationId - the station whose status changed.
   * @param online - the station's new state.
   */
  private async onStationStatus(stationId: StationId, online: boolean): Promise<void> {
    if (this.stopping) return
    if (!online) {
      const parked = await this.store.parkStationRunning(stationId)
      for (const record of parked) {
        this.ctx.logger.warn(
          `task-supervisor: station ${String(stationId)} went offline; task "${record.title}" (${String(record.taskId)}) is waiting-station`)
      }
      return
    }
    const waiting = (await this.list()).filter(record =>
      record.status === 'waiting-station' && record.stationId === stationId)
    for (const record of waiting) {
      if (this.stopping) return
      try {
        await this.resumeRun(record.taskId, { continuation: 'whenIdle' })
      } catch (error) {
        this.ctx.logger.warn(
          `task-supervisor: station resume of task "${record.title}" (${String(record.taskId)}) failed: `
          + (error instanceof Error ? error.message : String(error)))
      }
    }
  }

  /**
   * Teardown: quiesce in-flight resumes, park every running task in one
   * atomic write, then drain the agents this supervisor resumed so no turn
   * outlives the composition.
   */
  private async teardown(): Promise<void> {
    this.stopping = true
    await Promise.allSettled([...this.resumeRuns.values()])
    const parked = await this.store.flipRunning('paused')
    if (parked.length > 0) {
      this.ctx.logger.warn(`task-supervisor: parked ${parked.length} running task(s) for the next start`)
    }
    const owned = [...this.handles.values()]
    this.handles.clear()
    await Promise.all(owned.map(async (handle) => {
      try {
        await handle.dispose()
      } catch (error) {
        this.ctx.logger.warn(
          'task-supervisor: disposal of a resumed agent failed: '
          + (error instanceof Error ? error.message : String(error)))
      }
    }))
  }
}

export default TaskSupervisor
