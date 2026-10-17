/**
 * `@deepseek-ai/dsh-web-fetch-http`: registers an anonymous public HTTP(S)
 * `WebFetchProvider` with `ctx.web`, guarded against non-public destinations,
 * and exposes the provider's limits as a settings namespace. A
 * function/namespace plugin (NOT a default-export service): it registers INTO
 * the seam's fetch registry, like the search providers register into the
 * search registry.
 *
 * @module @deepseek-ai/dsh-web-fetch-http
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { HttpFetchProvider } from './provider.ts'
import type { HttpFetchLimits } from './provider.ts'

const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647

/** Default maximum accepted request URL length. */
const DEFAULT_MAX_URL_LENGTH = 2048
/** Default maximum response body size in bytes. */
const DEFAULT_MAX_RESPONSE_BYTES = 5_000_000
/** Default maximum decoded body length in characters. */
const DEFAULT_MAX_BODY_CHARS = 100_000
/** Default fetch timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000
/** Default maximum number of same-origin redirect hops. */
const DEFAULT_MAX_REDIRECTS = 5

export {
  LOCAL_FETCH_PROVIDER_ID,
  HttpFetchProvider,
} from './provider.ts'
export type { HttpFetchLimits } from './provider.ts'

/** Default `User-Agent`: an explicit product agent, never a browser disguise. */
export const DEFAULT_USER_AGENT = 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-fetch-http'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config: the provider's transport and size limits plus its `User-Agent` (all defaulted, no secrets). */
export interface Config {
  /** Maximum accepted request URL length. */
  maxUrlLength?: number
  /** Maximum response body size in bytes. */
  maxResponseBytes?: number
  /** Maximum decoded body length in characters. */
  maxBodyChars?: number
  /** Default fetch timeout in milliseconds, within Node's timer range. */
  timeoutMs?: number
  /** Maximum number of same-origin redirect hops to follow. */
  maxRedirects?: number
  /** `User-Agent` header sent on every request. */
  userAgent?: string
}

export const Config: z<Config> = z.object({
  maxUrlLength: z.number().default(DEFAULT_MAX_URL_LENGTH),
  maxResponseBytes: z.number().default(DEFAULT_MAX_RESPONSE_BYTES),
  maxBodyChars: z.number().default(DEFAULT_MAX_BODY_CHARS),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  maxRedirects: z.number().default(DEFAULT_MAX_REDIRECTS),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
})

/** Settings namespace carrying this provider's limits (no secrets). */
export const WEB_FETCH_HTTP_SETTINGS_NAMESPACE = settingsNamespace('web-fetch-http')

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/**
 * Project one resolved section into the limits the provider serves its next
 * fetch with.
 * @param config - the currently authoritative section.
 * @returns the limits for one fetch.
 */
function projectLimits(config: ResolvedConfig): HttpFetchLimits {
  return {
    maxUrlLength: config.maxUrlLength,
    maxResponseBytes: config.maxResponseBytes,
    maxBodyChars: config.maxBodyChars,
    timeoutMs: config.timeoutMs,
    maxRedirects: config.maxRedirects,
    userAgent: config.userAgent,
  }
}

/** A resource limit (byte/char/length/timeout cap) must be a positive finite number. */
function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`web-fetch-http: ${name} must be a positive finite number`)
  }
}

/** Node coerces larger timer delays to 1 ms, so reject them at configuration time. */
function assertTimeoutMs(value: number): void {
  assertPositiveFinite('timeoutMs', value)
  if (value > MAX_NODE_TIMER_DELAY_MS) {
    throw new Error(`web-fetch-http: timeoutMs must be no greater than ${MAX_NODE_TIMER_DELAY_MS}`)
  }
}

/** The redirect hop cap must be a non-negative integer (0 follows no redirects). */
function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`web-fetch-http: ${name} must be a non-negative integer`)
  }
}

/**
 * Enforce the constraints the schema cannot express: positive finite caps, the
 * Node timer bound on `timeoutMs`, and a non-negative integer redirect cap.
 * Runs at plugin construction and as the settings section validator, so a bad
 * stored value is refused at the write.
 * @param config - the section to validate.
 */
function assertLimits(config: Config): void {
  // schemastery (Config) has already filled every defaulted field at both
  // entry points: the plugin's composition entry and the resolved section.
  const limits = projectLimits(config as ResolvedConfig)
  assertPositiveFinite('maxUrlLength', limits.maxUrlLength)
  assertPositiveFinite('maxResponseBytes', limits.maxResponseBytes)
  assertPositiveFinite('maxBodyChars', limits.maxBodyChars)
  assertTimeoutMs(limits.timeoutMs)
  assertNonNegativeInteger('maxRedirects', limits.maxRedirects)
}

/** Register the local HTTP(S) fetch provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  assertLimits(config)
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_FETCH_HTTP_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    validate: assertLimits,
    // The registration carries no resolved value: the provider projects the
    // section per fetch, so a committed change needs no re-registration.
    onChange: () => {},
  })
  ctx.web.registerFetchProvider(new HttpFetchProvider(() => projectLimits(current() as ResolvedConfig)))
}
