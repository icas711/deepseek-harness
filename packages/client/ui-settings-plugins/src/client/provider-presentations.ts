/**
 * Static wiring of every provider card this package ships: the settings
 * namespaces it binds, the section fields it edits (mirroring each Host
 * namespace's served schema), and the copy keys its card renders.
 */

import { numberField, textField, type CardFieldSpec } from './card-form.ts'
import type { ProviderCardPresentation } from './provider-card-controller.ts'

/** Namespace of the DeepSeek search provider. */
export const WEB_SEARCH_DEEPSEEK_NS = 'web-search-deepseek'
/** Namespace of the Z.ai search provider. */
export const WEB_SEARCH_ZAI_NS = 'web-search-zai'
/** Namespace of the Exa search provider. */
export const WEB_SEARCH_EXA_NS = 'web-search-exa'
/** Namespace of the Perplexity search provider. */
export const WEB_SEARCH_PERPLEXITY_NS = 'web-search-perplexity'
/** Namespace of the HTTP fetch provider's limits. */
export const WEB_FETCH_HTTP_NS = 'web-fetch-http'

/** The DeepSeek search provider's section document. */
export interface WebSearchSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Provider endpoint; blank inherits the provider default. */
  baseURL?: string
  /** Maximum searches served within one request. */
  maxUses?: number
}

/** The Z.ai search provider's section document. */
export interface ZaiSearchSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Provider endpoint; blank inherits the provider default. */
  baseURL?: string
  /** Which Z.ai search engine answers a query. */
  searchEngine?: string
  /** Result count when a request sets no limit. */
  count?: number
}

/** The Exa search provider's section document. */
export interface ExaSearchSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Provider endpoint; blank inherits the provider default. */
  baseURL?: string
  /** How Exa selects documents: auto, keyword, or neural. */
  searchType?: string
  /** Result count when a request sets no limit. */
  numResults?: number
  /** Excerpts returned per result. */
  highlightsPerResult?: number
}

/** The Perplexity search provider's section document. */
export interface PerplexitySearchSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Provider endpoint; blank inherits the provider default. */
  baseURL?: string
  /** Which Perplexity model answers a query. */
  model?: string
  /** Token budget of one search response. */
  maxTokens?: number
  /** How fresh the retrieved documents must be. */
  searchRecency?: string
}

/** The HTTP fetch provider's section document. */
export interface FetchHttpSettings {
  /** URLs longer than this are refused before the request. */
  maxUrlLength?: number
  /** Responses larger than this are refused. */
  maxResponseBytes?: number
  /** The returned body is cut to this length. */
  maxBodyChars?: number
  /** Wall-clock budget of one fetch. */
  timeoutMs?: number
  /** Redirects one fetch may follow. */
  maxRedirects?: number
  /** The User-Agent line the provider sends with every request. */
  userAgent?: string
}

/** One provider card's constructor wiring minus its scope. */
export interface ProviderCardSetup {
  /** The section fields this card edits, in presentation order. */
  fields: CardFieldSpec[]
  /** The card's copy keys and display fields. */
  presentation: ProviderCardPresentation
}

/** The DeepSeek search provider's card wiring. */
export const DEEPSEEK_CARD: ProviderCardSetup = {
  fields: [textField('baseURL'), numberField('maxUses')],
  presentation: {
    titleKey: 'webSearchTitle',
    descriptionKey: 'webSearchDescription',
    fields: [
      { field: 'baseURL', labelKey: 'webSearchBaseUrl', hintKey: 'webSearchBaseUrlHint' },
      { field: 'maxUses', labelKey: 'webSearchMaxUses', hintKey: 'webSearchMaxUsesHint', numeric: true },
    ],
    credential: { labelKey: 'apiKeyLabel', hintKey: 'apiKeyHint', configuredKey: 'apiKeySet', missingKey: 'apiKeyUnset' },
  },
}

/** The Z.ai search provider's card wiring. */
export const ZAI_CARD: ProviderCardSetup = {
  fields: [textField('baseURL'), textField('searchEngine'), numberField('count')],
  presentation: {
    titleKey: 'zaiTitle',
    descriptionKey: 'zaiDescription',
    fields: [
      { field: 'baseURL', labelKey: 'zaiBaseUrl', hintKey: 'zaiBaseUrlHint' },
      { field: 'searchEngine', labelKey: 'zaiSearchEngine', hintKey: 'zaiSearchEngineHint' },
      { field: 'count', labelKey: 'zaiCount', hintKey: 'zaiCountHint', numeric: true },
    ],
    credential: { labelKey: 'apiKeyLabel', hintKey: 'apiKeyHint', configuredKey: 'apiKeySet', missingKey: 'apiKeyUnset' },
  },
}

/** The Exa search provider's card wiring. */
export const EXA_CARD: ProviderCardSetup = {
  fields: [textField('baseURL'), textField('searchType'), numberField('numResults'), numberField('highlightsPerResult')],
  presentation: {
    titleKey: 'exaTitle',
    descriptionKey: 'exaDescription',
    fields: [
      { field: 'baseURL', labelKey: 'exaBaseUrl', hintKey: 'exaBaseUrlHint' },
      { field: 'searchType', labelKey: 'exaSearchType', hintKey: 'exaSearchTypeHint' },
      { field: 'numResults', labelKey: 'exaNumResults', hintKey: 'exaNumResultsHint', numeric: true },
      { field: 'highlightsPerResult', labelKey: 'exaHighlights', hintKey: 'exaHighlightsHint', numeric: true },
    ],
    credential: { labelKey: 'apiKeyLabel', hintKey: 'apiKeyHint', configuredKey: 'apiKeySet', missingKey: 'apiKeyUnset' },
  },
}

/** The Perplexity search provider's card wiring. */
export const PERPLEXITY_CARD: ProviderCardSetup = {
  fields: [textField('baseURL'), textField('model'), numberField('maxTokens'), textField('searchRecency')],
  presentation: {
    titleKey: 'perplexityTitle',
    descriptionKey: 'perplexityDescription',
    fields: [
      { field: 'baseURL', labelKey: 'perplexityBaseUrl', hintKey: 'perplexityBaseUrlHint' },
      { field: 'model', labelKey: 'perplexityModel', hintKey: 'perplexityModelHint' },
      { field: 'maxTokens', labelKey: 'perplexityMaxTokens', hintKey: 'perplexityMaxTokensHint', numeric: true },
      { field: 'searchRecency', labelKey: 'perplexitySearchRecency', hintKey: 'perplexitySearchRecencyHint' },
    ],
    credential: { labelKey: 'apiKeyLabel', hintKey: 'apiKeyHint', configuredKey: 'apiKeySet', missingKey: 'apiKeyUnset' },
  },
}

/** The HTTP fetch provider's card wiring — limits only, no key. */
export const FETCH_HTTP_CARD: ProviderCardSetup = {
  fields: [
    numberField('maxUrlLength'),
    numberField('maxResponseBytes'),
    numberField('maxBodyChars'),
    numberField('timeoutMs'),
    numberField('maxRedirects'),
    textField('userAgent'),
  ],
  presentation: {
    titleKey: 'webFetchTitle',
    descriptionKey: 'webFetchDescription',
    fields: [
      { field: 'maxUrlLength', labelKey: 'webFetchMaxUrlLength', hintKey: 'webFetchMaxUrlLengthHint', numeric: true },
      { field: 'maxResponseBytes', labelKey: 'webFetchMaxResponseBytes', hintKey: 'webFetchMaxResponseBytesHint', numeric: true },
      { field: 'maxBodyChars', labelKey: 'webFetchMaxBodyChars', hintKey: 'webFetchMaxBodyCharsHint', numeric: true },
      { field: 'timeoutMs', labelKey: 'webFetchTimeoutMs', hintKey: 'webFetchTimeoutMsHint', numeric: true },
      { field: 'maxRedirects', labelKey: 'webFetchMaxRedirects', hintKey: 'webFetchMaxRedirectsHint', numeric: true },
      { field: 'userAgent', labelKey: 'webFetchUserAgent', hintKey: 'webFetchUserAgentHint' },
    ],
  },
}
