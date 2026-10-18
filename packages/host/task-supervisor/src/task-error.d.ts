/**
 * Caller-facing failure of the task supervisor, carrying one stable code.
 * @module @deepseek-ai/dsh-task-supervisor/task-error
 */
/**
 * The supervisor's single error type: every refusal — unknown task, invalid
 * transition, teardown in progress, unavailable resume path — is a
 * {@link TaskSupervisorError} with a stable machine-readable `code`.
 */
export declare class TaskSupervisorError extends Error {
    readonly code: 'unknown-task' | 'invalid-transition' | 'invalid-reason' | 'stopping' | 'resume-unavailable' | 'session-not-found';
    /**
     * Construct one supervisor refusal.
     * @param message - human-readable explanation.
     * @param code - stable caller-facing code (`unknown-task`, `invalid-transition`, `invalid-reason`,
     * `stopping`, `resume-unavailable`, `session-not-found`).
     */
    constructor(message: string, code: 'unknown-task' | 'invalid-transition' | 'invalid-reason' | 'stopping' | 'resume-unavailable' | 'session-not-found');
}
//# sourceMappingURL=task-error.d.ts.map