/**
 * `@deepseek-ai/dsh-web-search-zai`: registers a Z.ai-backed `WebSearchProvider`
 * with `ctx.web` and publishes the provider's settings namespace (`apiKeyEnv`,
 * `baseURL`, `searchEngine`, `count`). A function/namespace plugin (NOT a
 * default-export service): it registers INTO the seam's provider registry, like
 * `@deepseek-ai/dsh-web-search-perplexity`.
 *
 * @module @deepseek-ai/dsh-web-search-zai
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-web'
import {
  ZaiSearchProvider,
  ZAI_DEFAULT_BASE_URL,
  ZAI_DEFAULT_COUNT,
  ZAI_DEFAULT_SEARCH_ENGINE,
  ZAI_MAX_COUNT,
  ZAI_MIN_COUNT,
} from './provider.ts'
import type { ZaiSearchProviderOptions } from './provider.ts'

export {
  ZAI_DEFAULT_BASE_URL,
  ZAI_DEFAULT_COUNT,
  ZAI_DEFAULT_SEARCH_ENGINE,
  ZAI_MAX_COUNT,
  ZAI_MIN_COUNT,
  ZAI_PROVIDER_ID,
  ZaiSearchProvider,
  clampZaiCount,
} from './provider.ts'
export type { ZaiSearchProviderOptions } from './provider.ts'
export type { ZaiError, ZaiSearchRequest, ZaiSearchResponse, ZaiSearchResult } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-zai'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'ZAI_API_KEY'

/**
 * Environment variable naming this provider's endpoint. Deliberately distinct
 * from `$ZAI_BASE_URL`, which belongs to the chat adapter: deployments point it
 * at the coding-plan endpoint, which does not serve `/web_search`.
 */
const SEARCH_BASE_URL_ENV = 'ZAI_SEARCH_BASE_URL'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Z.ai API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `ZAI_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/web_search` is appended. Defaults to the public Z.ai API. */
  baseURL?: string
  /** Search engine tier sent as `search_engine`. Defaults to `search-prime`. */
  searchEngine?: string
  /** Requested result count when the search sets no `maxResults`; range 1–50. Defaults to 10. */
  count?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string(),
  searchEngine: z.string().default(ZAI_DEFAULT_SEARCH_ENGINE),
  count: z.number().step(1).min(ZAI_MIN_COUNT).max(ZAI_MAX_COUNT).default(ZAI_DEFAULT_COUNT),
})

/** Settings namespace carrying this provider's key reference, endpoint, and request defaults. */
export const WEB_SEARCH_ZAI_SETTINGS_NAMESPACE = settingsNamespace('web-search-zai')

/**
 * The projection's string step: a blank stored value means "no value" (a
 * settings edit clears to it), so it defers to the fallback exactly like an
 * absent field.
 * @param value - the section's stored value, when the field carries one.
 * @param fallback - the next value in the projection chain.
 * @returns `value` when present and non-empty, `fallback` otherwise.
 */
function nonEmptyOr(value: string | undefined, fallback: string): string {
  return value !== undefined && value.length > 0 ? value : fallback
}

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(ctx: Context, config: Config): ZaiSearchProviderOptions {
  /* jscpd:ignore-start — the section-projection convention (env fallbacks live in
     the projection, the provider reads fully defaulted values, the key resolves
     per search) mirrors web-search-deepseek verbatim; diverging the wording would
     only hide that both providers resolve their configuration identically. */
  const apiKeyEnv = nonEmptyOr(config.apiKeyEnv, DEFAULT_API_KEY_ENV)
  const apiKeyRef = credentialRef(apiKeyEnv)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyRef))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyRef)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv: apiKeyRef,
    baseURL: nonEmptyOr(
      config.baseURL,
      launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value ?? ZAI_DEFAULT_BASE_URL,
    ),
    searchEngine: nonEmptyOr(config.searchEngine, ZAI_DEFAULT_SEARCH_ENGINE),
    count: config.count ?? ZAI_DEFAULT_COUNT,
  }
  /* jscpd:ignore-end */
}

/** Register the Z.ai search provider with `ctx.web` and its settings namespace. */
export function apply(ctx: Context, config: Config): void {
  /* jscpd:ignore-start — the optional-settings wiring (source thunk over the
     installed section, no re-registration on a committed change) mirrors
     web-search-deepseek; see the projection note above. */
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_ZAI_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per search, so a committed change needs no re-registration.
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new ZaiSearchProvider(() => resolveOptions(ctx, current())))
  /* jscpd:ignore-end */
}
