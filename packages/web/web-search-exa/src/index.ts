/**
 * `@deepseek-ai/dsh-web-search-exa`: registers an Exa-backed `WebSearchProvider`
 * with `ctx.web`. A function/namespace plugin (NOT a default-export service):
 * a search provider does not own the `ctx.web` key — it registers INTO the
 * seam's provider registry, exactly as `@deepseek-ai/dsh-llm-deepseek`
 * registers an adapter into `ctx.llm`. The key is owned by `@deepseek-ai/dsh-web`.
 * The plugin also registers the `web-search-exa` settings namespace, so the
 * endpoint, retrieval defaults, and key reference are editable from the
 * settings page and reach the next search without a restart.
 *
 * @module @deepseek-ai/dsh-web-search-exa
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-web'
import {
  ExaSearchProvider,
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
  EXA_DEFAULT_SEARCH_TYPE,
} from './provider.ts'
import type { ExaSearchProviderOptions } from './provider.ts'

export {
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
  EXA_DEFAULT_SEARCH_TYPE,
  EXA_PROVIDER_ID,
  ExaSearchProvider,
} from './provider.ts'
export type { ExaSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-exa'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'EXA_API_KEY'

/** Plugin config (all optional — the schema declares the constant defaults). */
export interface Config {
  /** Literal Exa API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; empty or absent falls back to `EXA_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Retrieval mode sent as Exa's `type`. Defaults to `auto`. */
  searchType?: 'auto' | 'keyword' | 'neural'
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Highlight sentences requested per result. Defaults to 1. */
  highlightsPerResult?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string(),
  searchType: z.union(['auto', 'keyword', 'neural'] as const).default(EXA_DEFAULT_SEARCH_TYPE),
  numResults: z.number().step(1).min(1),
  highlightsPerResult: z.number().step(1).min(1).default(EXA_DEFAULT_HIGHLIGHTS_PER_RESULT),
})

/** Settings namespace carrying this provider's endpoint, retrieval defaults, and key reference. */
export const WEB_SEARCH_EXA_SETTINGS_NAMESPACE = settingsNamespace('web-search-exa')

/**
 * The section as the plugin receives it: Cordis's `resolveConfig` has applied
 * the Config schema, so every field carrying a schema default is present.
 */
type ResolvedSection = Config & Required<Pick<Config, 'apiKeyEnv' | 'searchType' | 'highlightsPerResult'>>

/**
 * Normalize the section's key reference. An empty value (a cleared field in a
 * configuration surface) means the fallback variable, so it resolves as
 * `EXA_API_KEY` instead of failing a blank-reference lookup.
 * @param config - the currently authoritative section.
 * @returns the credential reference to resolve.
 */
function resolveApiKeyEnv(config: ResolvedSection): CredentialRef {
  return credentialRef(config.apiKeyEnv.length > 0 ? config.apiKeyEnv : DEFAULT_API_KEY_ENV)
}

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(ctx: Context, config: ResolvedSection): ExaSearchProviderOptions {
  const apiKeyEnv = resolveApiKeyEnv(config)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    /* jscpd:ignore-start — the credential-resolution convention (credentials seam,
       then launch environment) mirrors web-search-zai verbatim; diverging the
       wording would only hide that both providers resolve keys identically. */
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    /* jscpd:ignore-end */
    apiKeyEnv,
    baseURL: config.baseURL ?? EXA_DEFAULT_BASE_URL,
    searchType: config.searchType,
    highlightsPerResult: config.highlightsPerResult,
    ...config.numResults !== undefined ? { numResults: config.numResults } : {},
  }
}

/** Register the Exa search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_EXA_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per search, so a committed change needs no re-registration.
    onChange: () => {},
  })
  // The section source is the schema-resolved scope or the schema-resolved
  // composition entry; both carry the defaults the Config schema declares.
  ctx.web.registerSearchProvider(new ExaSearchProvider(
    () => resolveOptions(ctx, current() as ResolvedSection),
  ))
}
