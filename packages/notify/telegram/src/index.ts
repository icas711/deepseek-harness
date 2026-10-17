/**
 * Telegram notifier row: passive without `DSH_TELEGRAM_BOT_TOKEN`, otherwise
 * mounts the Telegram provider of the notifier seam (`ctx.notifier`) and
 * its task-status watcher over `ctx.taskSupervisor`.
 * @module @deepseek-ai/dsh-telegram-notifier
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TelegramNotifier } from './service.ts'

/** Stable Cordis plugin name. */
export const name = 'telegram-notifier'

/** Services required before the row mounts: none — the passive mode must hold in every composition. */
export const inject: string[] = []

/** Plugin configuration: composition-supplied deployment settings. */
export interface Config {
  /** `DSH_TELEGRAM_BOT_TOKEN` — empty or absent leaves the row passive: no service, no timers, no network. */
  botToken?: string
  /** `DSH_WEB_URL` — base URL for session links; absent, the texts carry no link. */
  webBaseUrl?: string
  /** Bindings document path override; defaults to `telegram-bindings.json` in the harness home. */
  bindingsPath?: string
  /** Pairing-code lifetime in milliseconds; defaults to 15 minutes. */
  bindingCodeTtlMs?: number
  /** `getUpdates` period in milliseconds; defaults to 3000. */
  pollIntervalMs?: number
  /** Task-list poll period in milliseconds; defaults to 15000. */
  watchIntervalMs?: number
}

export const Config: z<Config> = z.object({
  botToken: z.string(),
  webBaseUrl: z.string(),
  bindingsPath: z.string(),
  bindingCodeTtlMs: z.natural(),
  pollIntervalMs: z.natural().min(50),
  watchIntervalMs: z.natural().min(50),
})

/**
 * Mount the Telegram provider when a bot token is configured; otherwise do
 * nothing at all.
 * @param ctx - plugin context; with a token this row becomes the `ctx.notifier` provider.
 * @param config - validated {@link Config}.
 * @returns a promise settling once the mounted provider finished starting.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const botToken = config.botToken?.trim() ?? ''
  if (botToken === '') {
    // Passive mode: no service, no effects — the same rule as web-auth.
    return
  }
  await ctx.plugin(TelegramNotifier, {
    botToken,
    ...(config.bindingsPath !== undefined && { bindingsPath: config.bindingsPath }),
    ...(config.bindingCodeTtlMs !== undefined && { bindingCodeTtlMs: config.bindingCodeTtlMs }),
    ...(config.webBaseUrl !== undefined && { webBaseUrl: config.webBaseUrl }),
    ...(config.pollIntervalMs !== undefined && { pollIntervalMs: config.pollIntervalMs }),
    ...(config.watchIntervalMs !== undefined && { watchIntervalMs: config.watchIntervalMs }),
  })
}

export { BINDINGS_FILENAME, parseUpdate, resolveSpec, TelegramNotifier } from './service.ts'
export type { Config as ServiceConfig, ParsedUpdate, ResolvedSpec } from './service.ts'
export { TelegramApiError, transportFactory } from './transport.ts'
export { bindingConfirmedText, BINDING_CONFIRMED_TAIL, BINDING_FAILED_TEXT, BINDING_HINT_TEXT, BINDING_REJECTED_TEXT, formatSessionLink, formatTaskText } from './messages.ts'
export { TaskWatcher } from './watcher.ts'
export type { NotifierFace, TaskSource } from './watcher.ts'
