/**
 * Durable task supervisor (`ctx.taskSupervisor`): a home-folder task registry
 * whose running tasks survive process restarts. A clean unload parks every
 * running task (`paused`) before teardown; the next start marks tasks the
 * predecessor died on (`interrupted`) and automatically resumes parked ones
 * by reopening their sessions and delivering one continuation message
 * through the ordinary logged input path.
 * @module @deepseek-ai/dsh-task-supervisor
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { StationId } from '@deepseek-ai/dsh-station-protocol';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { TaskId, TaskView } from './types.ts';
export type { StationId, TaskId, TaskRecord, TaskStatus, TaskView } from './types.ts';
export { TaskSupervisorError } from './task-error.ts';
export { CONTINUATION_PROMPT, STATION_CONTINUATION_PROMPT, buildContinuationMessage, buildStationContinuationMessage, stationWorldSetup, } from './resume.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Durable cross-restart task supervisor. */
        taskSupervisor: TaskSupervisor;
    }
}
/** Plugin configuration: composition-supplied deployment settings. */
export interface Config {
    /**
     * Task registry document path. Required (no default): records carry
     * session identities and task labels, so the location is stated
     * explicitly — compositions pass `dshHomePath('task-registry.json')`.
     */
    registryPath: string;
}
/** The task supervisor service (`ctx.taskSupervisor`). */
export declare class TaskSupervisor extends Service {
    static Config: z<Config>;
    private readonly store;
    /** Set before the durable pause so no mutation lands after it. */
    private stopping;
    /** Resolves once the registry is loaded and the startup flip committed. */
    private ready;
    /** In-flight resume operations, awaited by teardown before the pause. */
    private readonly resumeRuns;
    /** Handles of agents this supervisor resumed; drained at teardown. */
    private readonly handles;
    /**
     * Construct the service. Initialization runs in {@link TaskSupervisor.init}:
     * a corrupt registry document fails the fiber loud at load.
     * @param ctx - context providing the agent registry and, optionally, the
     * persistence, preset-roster, and default-model services.
     * @param config - validated {@link Config}.
     */
    constructor(ctx: Context, config: Config);
    /**
     * Load the registry, reconcile the startup state, and register the
     * lifecycle effects: parked tasks resume once an agent factory exists, and
     * teardown parks every running task before the rest of the tree unwinds.
     */
    protected [Service.init](): Promise<void>;
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
    track(request: {
        sessionId: SessionId;
        title: string;
        stationId?: StationId;
    }): Promise<TaskView>;
    /**
     * Mark a task completed.
     * @param taskId - the task to settle.
     * @returns the committed record.
     * @throws {@link TaskSupervisorError} with `unknown-task`,
     * `invalid-transition` (terminal or wrong status), or `stopping`.
     */
    markCompleted(taskId: TaskId): Promise<TaskView>;
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
    markFailed(taskId: TaskId, reason: string): Promise<TaskView>;
    /**
     * Snapshot the whole registry for callers outside the service, such as a
     * notification watcher diffing task statuses between ticks.
     * @returns fresh copies of every record, in registry order. Safe before
     * initialization settles: the read follows {@link TaskSupervisor.ready}.
     */
    list(): Promise<TaskView[]>;
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
    resume(taskId: TaskId): Promise<TaskView>;
    /** Reject mutations once teardown started parking tasks. */
    private assertAccepting;
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
    private resumeRun;
    /**
     * Resume every parked task, and every `waiting-station` task whose station
     * is already online, once each — containing every failure to its task.
     * Runs when the agent factory appears; the station-online branch covers the
     * mount orders where a station connected before this service or before the
     * loop was ready.
     */
    private autoResumeParked;
    /**
     * Apply one station/status transition to the bound tasks: offline parks
     * every running record bound to that station in one durable write; online
     * auto-resumes its `waiting-station` tasks with the
     * `whenIdle` continuation rule.
     * @param stationId - the station whose status changed.
     * @param online - the station's new state.
     */
    private onStationStatus;
    /**
     * Teardown: quiesce in-flight resumes, park every running task in one
     * atomic write, then drain the agents this supervisor resumed so no turn
     * outlives the composition.
     */
    private teardown;
}
export default TaskSupervisor;
//# sourceMappingURL=index.d.ts.map