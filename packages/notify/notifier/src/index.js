/**
 * Service Definition for the notification seam (`ctx.notifier`):
 * login-addressed notifications and pairing-code bindings. The seam knows
 * destinations only as opaque ids bound per login; a provider owns the
 * transport, the human wording, and how a user presents a pairing code. The
 * base class owns the durable bindings document and the pending-code table,
 * so every provider shares one binding semantics.
 * @module @deepseek-ai/dsh-notifier
 */
import { randomBytes } from 'node:crypto';
import { Service } from '@deepseek-ai/cordis';
import { BindingCode } from "./brand.js";
import { BindingStore, LOGIN_PATTERN } from "./bindings.js";
import { NotifierError } from "./notifier-error.js";
export { BindingCode, ChatId } from "./brand.js";
export { BindingFileError, BINDINGS_FORMAT_VERSION, parseBindingsDocument, serializeBindingsDocument } from "./bindings.js";
export { NotifierError } from "./notifier-error.js";
/** The notification service (`ctx.notifier`). */
export class Notifier extends Service {
    store;
    /** Pairing-code lifetime, resolved once at construction. */
    bindingCodeTtlMs;
    /** Pending pairing codes keyed by code value; one live code per login. */
    pending = new Map();
    /** Resolves once the durable bindings document is loaded. */
    ready = Promise.resolve();
    /**
     * Construct the service. Initialization runs in the init hook: a corrupt
     * bindings document fails the fiber loud at load.
     * @param ctx - context owning the service.
     * @param config - validated {@link Config}.
     */
    constructor(ctx, config) {
        super(ctx, 'notifier');
        this.store = new BindingStore(config.bindingsPath);
        this.bindingCodeTtlMs = config.bindingCodeTtlMs;
    }
    /** Load the durable bindings document before the first operation. */
    async [Service.init]() {
        this.ready = this.store.load();
        await this.ready;
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
    async beginBinding(login) {
        await this.ready;
        if (typeof login !== 'string' || !LOGIN_PATTERN.test(login)) {
            throw new NotifierError(`notifier: login must be 1-128 characters without whitespace or control characters, got ${JSON.stringify(login)}`, 'invalid-login');
        }
        this.pruneExpired();
        for (const [code, entry] of this.pending) {
            if (entry.login === login)
                this.pending.delete(code);
        }
        const code = BindingCode(randomBytes(4).toString('hex'));
        this.pending.set(code, { login, expiresAt: Date.now() + this.bindingCodeTtlMs });
        return { code };
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
    async send(request) {
        await this.ready;
        const binding = this.store.get(request.login);
        if (binding === undefined)
            return 'unbound';
        await this.deliver(request, binding);
        return 'sent';
    }
    /**
     * Enumerate the logins that currently hold a confirmed binding, in
     * document order. Broadcast-style consumers (the task watcher) address
     * their sends through this list; a per-login UI page will list the same
     * records.
     * @returns the bound logins.
     */
    async boundLogins() {
        await this.ready;
        return this.store.logins();
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
    async completeBinding(code, chatId) {
        await this.ready;
        const entry = this.pending.get(code);
        if (entry === undefined || entry.expiresAt <= Date.now()) {
            this.pending.delete(code);
            throw new NotifierError('notifier: the pairing code is unknown or expired', 'unknown-code');
        }
        const record = await this.store.bind(entry.login, chatId);
        this.pending.delete(code);
        return record.login;
    }
    /** Drop expired pending codes. */
    pruneExpired() {
        const now = Date.now();
        for (const [code, entry] of this.pending) {
            if (entry.expiresAt <= now)
                this.pending.delete(code);
        }
    }
}
export default Notifier;
//# sourceMappingURL=index.js.map