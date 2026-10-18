/**
 * The notifier seam's coded error.
 * @module @deepseek-ai/dsh-notifier/notifier-error
 */
/** Coded error of the notifier service; providers branch on {@link code}. */
export class NotifierError extends Error {
    /** Stable machine-readable failure code. */
    code;
    /**
     * Construct one coded failure.
     * @param message - human-readable account of the failure.
     * @param code - machine-readable failure code.
     */
    constructor(message, code) {
        super(message);
        this.name = 'NotifierError';
        this.code = code;
    }
}
//# sourceMappingURL=notifier-error.js.map