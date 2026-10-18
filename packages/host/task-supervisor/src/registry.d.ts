/**
 * Durable task registry: the `task-registry.json` document, its strict
 * boundary parse, and the in-process store. Every mutation re-renders the
 * whole document and commits it through the atomic-write writer lock, so
 * readers observe only complete old or complete new content and concurrent
 * processes merge instead of clobbering each other.
 * @module @deepseek-ai/dsh-task-supervisor/registry
 */
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { StationId } from '@deepseek-ai/dsh-station-protocol';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { TaskId, TaskRecord, TaskStatus } from './types.ts';
/** Brand a string as a {@link TaskId}.
 * @param value - the raw task id string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export declare function TaskId(value: string): TaskId;
/** On-disk format version, stamped into every document and enforced on load. */
export declare const REGISTRY_FORMAT_VERSION = 1;
/**
 * The registry document failed its boundary parse. Rendered as a boot failure
 * with operator guidance: a corrupt durable registry must fail loud, never be
 * silently ignored or overwritten.
 */
export declare class RegistryFileError extends Error {
    /**
     * Construct one parse failure.
     * @param filePath - the document that failed to parse.
     * @param reason - the concrete validation failure.
     */
    constructor(filePath: string, reason: string);
}
/**
 * Parse one registry document at the durable boundary. Every field is
 * validated; unknown statuses, non-records, and a foreign version fail loud.
 * @param text - complete file content.
 * @param filePath - the document path, named in failures.
 * @returns the parsed task records.
 * @throws {@link RegistryFileError} on any structural violation.
 */
export declare function parseRegistryDocument(text: string, filePath: string): TaskRecord[];
/**
 * Render the complete next document. Two-space indentation keeps the file
 * human-diffable; the trailing newline matches the repository file gate.
 * @param tasks - every record in the store's order.
 * @returns the complete file content to commit.
 */
export declare function serializeRegistryDocument(tasks: readonly TaskRecord[]): string;
/**
 * Replace `filename` with `content`, retrying the transient rename denials a
 * restart window produces. Any other failure, or a denial still standing at
 * the deadline, fails loud.
 * @param filename - final path receiving the content.
 * @param content - complete next file content.
 * @param replace - the atomic replace primitive; injected only by tests.
 */
export declare function replaceWithRetry(filename: string, content: string, replace?: typeof writeFileAtomic): Promise<void>;
/** Construction options of the store; `now` exists for tests' fake clocks. */
export interface TaskRegistryStoreOptions {
    /** Registry document path (a dsh-home path in compositions). */
    readonly filePath: string;
    /** Wall-clock source for `updatedAt`; defaults to `Date.now`. */
    readonly now?: () => number;
}
/**
 * The in-process authority over task records, mirrored to the durable
 * document. Memory leads: every mutation applies to the map first and then
 * commits a whole-document write that folds in any on-disk records this
 * process has not observed, so a second process sharing the home merges by
 * task id instead of erasing foreign tasks.
 */
export declare class TaskRegistryStore {
    private readonly records;
    private readonly filePath;
    private readonly now;
    /**
     * Construct the store without touching the file; {@link load} reads it.
     * @param options - document path and the optional clock.
     */
    constructor(options: TaskRegistryStoreOptions);
    /**
     * Read the durable document into memory. An absent file is the empty
     * registry; a present-but-invalid document throws — the caller fails the
     * boot loud rather than dropping tracked tasks.
     * @throws {@link RegistryFileError} when the document exists and is invalid.
     */
    load(): Promise<void>;
    /** @returns fresh copies of every record, in insertion order. */
    snapshot(): TaskRecord[];
    /**
     * @param taskId - the task to read.
     * @returns a fresh copy of the record, or `undefined` when unknown.
     */
    get(taskId: TaskId): TaskRecord | undefined;
    /**
     * @param sessionId - the session to look up.
     * @returns the session's single active (running/paused/interrupted) record,
     * or `undefined` when the session has only terminal history or nothing.
     */
    findActiveBySession(sessionId: SessionId): TaskRecord | undefined;
    /**
     * Track work: create the session's active record or retarget the existing
     * one. Idempotent by session id — a repeated identical call for an already
     * running task commits nothing. An explicit station binding rebinds the
     * record; an omitted one keeps the previous binding.
     * @param input - the session whose agent performs the work, its label, and
     *   the optional execution station the work is bound to.
     * @returns the up-to-date record and whether this call created it.
     */
    upsertRunning(input: {
        sessionId: SessionId;
        title: string;
        stationId?: TaskRecord['stationId'];
    }): Promise<{
        record: TaskRecord;
        created: boolean;
    }>;
    /**
     * Flip every running record bound to one station to `waiting-station` in a
     * single committed write — the station/status offline step. Tasks without
     * that binding, and records in any other status, stay untouched.
     * @param stationId - the station that dropped offline.
     * @returns the flipped records, empty when nothing was running on it.
     */
    parkStationRunning(stationId: StationId): Promise<TaskRecord[]>;
    /**
     * Move one task to another status through the closed transition table.
     * @param taskId - the task to transition.
     * @param status - the target status.
     * @returns the committed record.
     * @throws {@link TaskSupervisorError} with `unknown-task` or `invalid-transition`.
     */
    transition(taskId: TaskId, status: TaskStatus): Promise<TaskRecord>;
    /**
     * Flip every running record to one target of the startup/unload pair in a
     * single committed write — the atomic soft-restart step. Tasks already
     * parked or terminal stay untouched.
     * @param status - `paused` for a clean unload, `interrupted` after a hard crash.
     * @returns the flipped records, empty when nothing was running.
     */
    flipRunning(status: 'paused' | 'interrupted'): Promise<TaskRecord[]>;
    /**
     * Publish one record to the map only together with its durable commit: a
     * failed write rolls the memory side back, so the store never claims a
     * status the document does not hold.
     * @param taskId - the record's task id.
     * @param record - the next record to publish.
     */
    private settle;
    /**
     * Commit the in-memory map as the task-id union with the on-disk document.
     * The writer lock serializes cross-process read-modify-write cycles; the
     * atomic replace keeps every reader on complete content. A foreign document
     * that fails its parse fails the write loud instead of being overwritten —
     * the same stance as {@link load}.
     */
    private commit;
}
//# sourceMappingURL=registry.d.ts.map