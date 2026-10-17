/**
 * Telegram provider of the notifier seam: delivers login-addressed
 * notifications to the bound chat through `sendMessage` and confirms pairing
 * codes presented as "/start КОД", received by periodic `getUpdates` — no
 * webhook, no inbound ports. The same service hosts the task-status
 * watcher: the supervisor exposes no event feed, so the watcher polls
 * `list()` on a validated interval and diffs statuses in memory.
 * @module @deepseek-ai/dsh-telegram-notifier/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Notifier, NotifierError } from '@deepseek-ai/dsh-notifier'
import type { BindingRecord, NotificationRequest } from '@deepseek-ai/dsh-notifier'
import { bindingConfirmedText, BINDING_FAILED_TEXT, BINDING_HINT_TEXT, BINDING_REJECTED_TEXT, formatTaskText } from './messages.ts'
import { transportFactory } from './transport.ts'
import type { TelegramTransport } from './transport.ts'
import { TaskWatcher } from './watcher.ts'

/** Bindings document name inside the harness home; the composition may override the path. */
export const BINDINGS_FILENAME = 'telegram-bindings.json'

/** `getUpdates` period default; the config field is the deployment tuning. */
const DEFAULT_POLL_INTERVAL_MS = 3_000

/** Task-list poll period default; the config field is the deployment tuning. */
const DEFAULT_WATCH_INTERVAL_MS = 15_000

/** Pairing-code lifetime default (15 minutes). */
const DEFAULT_BINDING_CODE_TTL_MS = 900_000

/** Provider configuration, fully resolved by the wrapper row or a direct mount. */
export interface Config {
  /** Bot token from BotFather; non-empty (the wrapper row stays passive otherwise). */
  botToken: string
  /** Bindings document path; defaults to `telegram-bindings.json` in the harness home. */
  bindingsPath?: string
  /** Pairing-code lifetime in milliseconds; defaults to 15 minutes. */
  bindingCodeTtlMs?: number
  /** `getUpdates` period in milliseconds; defaults to 3000. */
  pollIntervalMs?: number
  /** Task-list poll period in milliseconds; defaults to 15000. */
  watchIntervalMs?: number
  /** Web base URL for session links (usually `DSH_WEB_URL`); absent, the texts carry no link. */
  webBaseUrl?: string
}

export const Config: z<Config> = z.object({
  botToken: z.string().required(),
  bindingsPath: z.string(),
  bindingCodeTtlMs: z.natural(),
  pollIntervalMs: z.natural().min(50),
  watchIntervalMs: z.natural().min(50),
  webBaseUrl: z.string(),
})

/** Fully resolved provider parameters; defaulting happens here, never inline. */
export interface ResolvedSpec {
  /** Trimmed, non-empty bot token. */
  botToken: string
  /** Bindings document path. */
  bindingsPath: string
  /** Pairing-code lifetime in milliseconds. */
  bindingCodeTtlMs: number
  /** `getUpdates` period in milliseconds. */
  pollIntervalMs: number
  /** Task-list poll period in milliseconds. */
  watchIntervalMs: number
  /** Web base URL for session links; undefined, the texts carry no link. */
  webBaseUrl: string | undefined
}

/**
 * Resolve the runtime spec from plugin config.
 * @param config - raw provider config.
 * @returns the resolved token, intervals, and locations.
 */
export function resolveSpec(config: Config): ResolvedSpec {
  const webBaseUrl = config.webBaseUrl?.trim()
  return {
    botToken: config.botToken.trim(),
    bindingsPath: config.bindingsPath ?? dshHomePath(BINDINGS_FILENAME),
    bindingCodeTtlMs: config.bindingCodeTtlMs ?? DEFAULT_BINDING_CODE_TTL_MS,
    pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    watchIntervalMs: config.watchIntervalMs ?? DEFAULT_WATCH_INTERVAL_MS,
    webBaseUrl: webBaseUrl === undefined || webBaseUrl === '' ? undefined : webBaseUrl,
  }
}

/** Matches "/start", optionally with a bot mention, and its one code argument. */
const START_COMMAND = /^\/start(?:@\S+)?(?:\s+(\S+))?/

/** One parsed Bot API update the binding flow cares about. */
export interface ParsedUpdate {
  /** The API’s monotonic update id. */
  updateId: number
  /** The chat the message arrived from, when present. */
  chatId: string | undefined
  /** The message text, when present. */
  text: string | undefined
}

/**
 * Parse one Bot API update at the wire boundary. Chat ids travel as JSON
 * numbers today; a string form is accepted too, and both are stored as
 * strings so the durable binding and the `sendMessage` payload agree.
 * @param update - one element of the `getUpdates` result array.
 * @returns the parsed update, or undefined when it is not a usable record.
 */
export function parseUpdate(update: unknown): ParsedUpdate | undefined {
  if (typeof update !== 'object' || update === null) return undefined
  const record = update as { update_id?: unknown; message?: unknown }
  if (typeof record.update_id !== 'number' || !Number.isSafeInteger(record.update_id)) return undefined
  let chatId: string | undefined
  let text: string | undefined
  if (typeof record.message === 'object' && record.message !== null) {
    const message = record.message as { chat?: unknown; text?: unknown }
    if (typeof message.chat === 'object' && message.chat !== null) {
      const chat = message.chat as { id?: unknown }
      if (typeof chat.id === 'number' && Number.isSafeInteger(chat.id)) chatId = String(chat.id)
      else if (typeof chat.id === 'string' && chat.id !== '') chatId = chat.id
    }
    if (typeof message.text === 'string') text = message.text
  }
  return { updateId: record.update_id, chatId, text }
}

/** The Telegram provider (`ctx.notifier` when mounted). */
export class TelegramNotifier extends Notifier {
  static Config: z<Config> = Config

  private readonly spec: ResolvedSpec
  private readonly transport: TelegramTransport
  /** `getUpdates` offset: the next update id the API should deliver. */
  private updatesOffset = 0
  private pollTimer: NodeJS.Timeout | undefined
  private watcher: TaskWatcher | undefined
  private stopping = false

  /**
   * Construct the provider.
   * @param ctx - context owning the service.
   * @param config - provider config; defaults resolve once, here.
   */
  constructor(ctx: Context, config: Config) {
    const spec = resolveSpec(config)
    super(ctx, { bindingsPath: spec.bindingsPath, bindingCodeTtlMs: spec.bindingCodeTtlMs })
    this.spec = spec
    this.transport = transportFactory.create(spec.botToken)
  }

  /** Start the update loop and, beside a task supervisor, the status watcher. */
  protected override async [Service.init](): Promise<void> {
    await super[Service.init]()
    // Registered first, so the loop stop is the LAST disposal: no tick may
    // race the fiber’s unwind.
    this.ctx.effect(() => () => {
      this.stopping = true
      if (this.pollTimer !== undefined) {
        clearTimeout(this.pollTimer)
        this.pollTimer = undefined
      }
      this.watcher?.stop()
      this.watcher = undefined
    }, 'telegram-notifier: stop the polling loops')
    this.armPoll()
    this.ctx.inject(['taskSupervisor'], (watchCtx) => {
      if (this.stopping) return
      const watcher = new TaskWatcher(
        watchCtx.taskSupervisor,
        this,
        (error) => {
          this.ctx.logger.warn('telegram-notifier: the task watcher reported a failure: %s', error instanceof Error ? error.message : String(error))
        },
      )
      watcher.start(this.spec.watchIntervalMs)
      this.watcher = watcher
    })
  }

  /**
   * Deliver one notification to the bound chat. Delivery failures reject, so
   * the watcher keeps the pair unnotified and retries on the next tick.
   * @param request - the notification to deliver.
   * @param binding - the confirmed login binding.
   * @throws the transport failure.
   */
  protected override async deliver(request: NotificationRequest, binding: BindingRecord): Promise<void> {
    await this.transport.call('sendMessage', {
      chat_id: binding.chatId,
      text: formatTaskText(request, this.spec.webBaseUrl),
    })
  }

  /** Arm the next `getUpdates` tick. */
  private armPoll(): void {
    if (this.stopping) return
    this.pollTimer = setTimeout(() => {
      void this.pollTick()
    }, this.spec.pollIntervalMs)
    // The poll loop must never keep a server process alive by itself.
    this.pollTimer.unref()
  }

  /** One poll: fetch updates, acknowledge them, and run the binding flow. */
  private async pollTick(): Promise<void> {
    try {
      const updates = await this.requestUpdates()
      // Acknowledge-first: a poison update must not block its successors,
      // and a failed binding stays unanswered (the user retries with a
      // fresh code).
      for (const update of updates) {
        this.updatesOffset = update.updateId + 1
        await this.handleUpdate(update)
      }
    } catch (error) {
      this.ctx.logger.warn('telegram-notifier: getUpdates failed: %s', error instanceof Error ? error.message : String(error))
    } finally {
      this.armPoll()
    }
  }

  /** Fetch and parse one batch of updates. */
  private async requestUpdates(): Promise<ParsedUpdate[]> {
    const result = await this.transport.call('getUpdates', {
      offset: this.updatesOffset,
      timeout: 0,
      allowed_updates: ['message'],
    })
    if (!Array.isArray(result)) return []
    const parsed: ParsedUpdate[] = []
    for (const raw of result) {
      const update = parseUpdate(raw)
      if (update === undefined) {
        this.ctx.logger.warn('telegram-notifier: skipping a malformed update: %s', JSON.stringify(raw).slice(0, 200))
        continue
      }
      parsed.push(update)
    }
    return parsed
  }

  /**
   * Run the binding flow for one update: `/start КОД` completes the pairing,
   * every other message gets the hint. Confirmation replies are best-effort.
   * @param update - the parsed update to answer.
   */
  private async handleUpdate(update: ParsedUpdate): Promise<void> {
    if (update.chatId === undefined) return
    const code = update.text?.match(START_COMMAND)?.[1]
    if (code === undefined) {
      await this.reply(update.chatId, BINDING_HINT_TEXT)
      return
    }
    try {
      const login = await this.completeBinding(code, update.chatId)
      await this.reply(update.chatId, bindingConfirmedText(login))
    } catch (error) {
      if (error instanceof NotifierError && error.code === 'unknown-code') {
        await this.reply(update.chatId, BINDING_REJECTED_TEXT)
        return
      }
      this.ctx.logger.warn('telegram-notifier: the binding did not commit: %s', error instanceof Error ? error.message : String(error))
      // The original failure is already logged above; a failed apology must
      // not surface as an unhandled rejection.
      await this.reply(update.chatId, BINDING_FAILED_TEXT).catch((replyError: unknown) => {
        this.ctx.logger.warn('telegram-notifier: the failure reply could not be delivered: %s', replyError instanceof Error ? replyError.message : String(replyError))
      })
    }
  }

  /**
   * Send one chat message; confirmations tolerate failures, deliveries do not.
   * @param chatId - the chat to write to.
   * @param text - the message text.
   * @throws the transport failure.
   */
  private async reply(chatId: string, text: string): Promise<void> {
    await this.transport.call('sendMessage', { chat_id: chatId, text })
  }
}

export default TelegramNotifier
