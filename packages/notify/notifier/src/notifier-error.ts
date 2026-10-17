/**
 * The notifier seam's coded error.
 * @module @deepseek-ai/dsh-notifier/notifier-error
 */

/** Machine-readable failure codes of the notifier service operations. */
export type NotifierErrorCode =
  /** beginBinding received a login no binding may carry. */
  | 'invalid-login'
  /** completeBinding received a code that is unknown or already expired. */
  | 'unknown-code'

/** Coded error of the notifier service; providers branch on {@link code}. */
export class NotifierError extends Error {
  /** Stable machine-readable failure code. */
  readonly code: NotifierErrorCode

  /**
   * Construct one coded failure.
   * @param message - human-readable account of the failure.
   * @param code - machine-readable failure code.
   */
  constructor(message: string, code: NotifierErrorCode) {
    super(message)
    this.name = 'NotifierError'
    this.code = code
  }
}
