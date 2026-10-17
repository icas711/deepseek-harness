/**
 * Service Definition for the notification seam (`ctx.notifier`):
 * login-addressed notifications and pairing-code bindings. The seam knows
 * destinations only as opaque ids bound per login; a provider owns the
 * transport, the human wording, and how a user presents a pairing code. The
 * base class owns the durable bindings document and the pending-code table,
 * so every provider shares one binding semantics.
 * @module @deepseek-ai/dsh-notifier
 */

import { randomBytes } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { BindingCode } from './brand.ts'
import { BindingStore, LOGIN_PATTERN } from './bindings.ts'
import { NotifierError } from './notifier-error.ts'
import type {
  BindingChallenge,
  BindingRecord,
  NotificationRequest,
  SendResult,
} from './types.ts'

export type {
  BindingChallenge,
  BindingRecord,
  NotificationKind,
  NotificationRequest,
  SendResult,
} from './types.ts'
export { BindingCode, ChatId } from './brand.ts'
export { BindingFileError, BINDINGS_FORMAT_VERSION, parseBindingsDocument, serializeBindingsDocument } from './bindings.ts'
export { NotifierError } from './notifier-error.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Login-addressed notification seam. */
    notifier: Notifier
  }
}

/** Plugin configuration: composition-supplied deployment settings. */
export interface Config {
  /**
   * Bindings document path. Required (no default): records pair user
   * identities with delivery destinations, so the location is stated
   * explicitly — the Telegram composition passes
   * `dshHomePath('telegram-bindings.json')`.
   */
  bindingsPath: string
  /** Pairing-code lifetime in milliseconds; providers resolve the deployment default in their spec step. */
  bindingCodeTtlMs: number
}

/** The notification service (`ctx.notifier`). */
export abstract class Notifier extends Service {
  private readonly store: BindingStore
  /** Pairing-code lifetime, resolved once at construction. */
  private readonly bindingCodeTtlMs: number
  /** Pending pairing codes keyed by code value; one live code per login. */
  private readonly pending = new Map<string, { login: string; expiresAt: number }>()
  /** Resolves once the durable bindings document is loaded. */
  private ready: Promise<void> = Promise.resolve()

  /**
   * Construct the service. Initialization runs in the init hook: a corrupt
   * bindings document fails the fiber loud at load.
   * @param ctx - context owning the service.
   * @param config - validated {@link Config}.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'notifier')
    this.store = new BindingStore(config.bindingsPath)
    this.bindingCodeTtlMs = config.bindingCodeTtlMs
  }

  /** Load the durable bindings document before the first operation. */
  protected async [Service.init](): Promise<void> {
    this.ready = this.store.load()
    await this.ready
  }

  /**
   * Begin one pairing: mint a single-use code the user presents to the
   * provider's transport (the Telegram provider accepts it as `/start КОД`).
   * Requesting a new code for a login invalidates that login's previous
   * code; codes are held in memory only, so a restart voids them and the
   * user simply requests a fresh one.
   * @param login - the user asking to bind a destination.
   * @returns the pairing challenge carrying the code.
   * @throws {@link NotifierError} with `invalid-login` when the login cannot
   * key a durable binding.
   */
  async beginBinding(login: string): Promise<BindingChallenge> {
    await this.ready
    if (typeof login !== 'string' || !LOGIN_PATTERN.test(login)) {
      throw new NotifierError(
        `notifier: login must be 1-128 characters without whitespace or control characters, got ${JSON.stringify(login)}`,
        'invalid-login',
      )
    }
    this.pruneExpired()
    for (const [code, entry] of this.pending) {
      if (entry.login === login) this.pending.delete(code)
    }
    const code = BindingCode(randomBytes(4).toString('hex'))
    this.pending.set(code, { login, expiresAt: Date.now() + this.bindingCodeTtlMs })
    return { code }
  }

  /**
   * Deliver one notification to the login's bound destination. An unbound
   * login drops the request without an error — there is nowhere to deliver
   * it; delivery failures reject, so callers can distinguish a dropped
   * request from a failed delivery and retry.
   * @param request - the notification to deliver.
   * @returns `sent` after a successful delivery, `unbound` when the login has no binding.
   * @throws whatever the provider's delivery throws.
   */
  async send(request: NotificationRequest): Promise<SendResult> {
    await this.ready
    const binding = this.store.get(request.login)
    if (binding === undefined) return 'unbound'
    await this.deliver(request, binding)
    return 'sent'
  }

  /**
   * Enumerate the logins that currently hold a confirmed binding, in
   * document order. Broadcast-style consumers (the task watcher) address
   * their sends through this list; a per-login UI page will list the same
   * records.
   * @returns the bound logins.
   */
  async boundLogins(): Promise<string[]> {
    await this.ready
    return this.store.logins()
  }

  /**
   * Confirm a pairing: validate the presented code against the pending table
   * and commit the binding durably. Providers call this from their transport
   * when a user presents the code; the confirmed code is consumed.
   * @param code - the user-presented code.
   * @param chatId - the destination id the code arrived from.
   * @returns the login the code was minted for.
   * @throws {@link NotifierError} with `unknown-code` when the code is
   * unknown, consumed, or expired.
   */
  protected async completeBinding(code: string, chatId: string): Promise<string> {
    await this.ready
    const entry = this.pending.get(code)
    if (entry === undefined || entry.expiresAt <= Date.now()) {
      this.pending.delete(code)
      throw new NotifierError('notifier: the pairing code is unknown or expired', 'unknown-code')
    }
    const record = await this.store.bind(entry.login, chatId)
    this.pending.delete(code)
    return record.login
  }

  /**
   * Deliver one request to one bound destination. Providers own the wording,
   * the transport call, and the failure semantics beyond rejection.
   * @param request - the notification to deliver.
   * @param binding - the confirmed login binding to deliver to.
   */
  protected abstract deliver(request: NotificationRequest, binding: BindingRecord): Promise<void>

  /** Drop expired pending codes. */
  private pruneExpired(): void {
    const now = Date.now()
    for (const [code, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(code)
    }
  }
}

export default Notifier
