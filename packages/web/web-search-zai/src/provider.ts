/**
 * Z.ai search over the standalone Web Search API (`POST /web_search`). The API returns
 * structured results with no generated answer, so the seam's optional `content` stays
 * unset. The wire format and native `fetch` client are provider-private and do not use
 * `ctx.llm`.
 * @module @deepseek-ai/dsh-web-search-zai/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { ZaiError, ZaiSearchResponse, ZaiSearchResult } from './types.ts'

/** Stable id this provider registers under. */
export const ZAI_PROVIDER_ID = 'zai'

/** Default Z.ai endpoint base; `/web_search` is the operation. */
export const ZAI_DEFAULT_BASE_URL = 'https://api.z.ai/api/paas/v4'

/** Default search engine tier; `search_engine` is a required request field. */
export const ZAI_DEFAULT_SEARCH_ENGINE = 'search-prime'

/** Requested result count when the incoming search sets no `maxResults`. */
export const ZAI_DEFAULT_COUNT = 10

/** API-side lower bound on the `count` request field. */
export const ZAI_MIN_COUNT = 1

/** API-side upper bound on the `count` request field. */
export const ZAI_MAX_COUNT = 50

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies credential and constant defaults). */
export interface ZaiSearchProviderOptions {
  /** Literal Z.ai API key; a non-empty literal wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolves the key for each search (credentials service, then launch environment). */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential-reference name surfaced in the missing-key error. */
  apiKeyEnv: string
  /** Endpoint base; `/web_search` is appended. */
  baseURL: string
  /** Search engine tier sent as `search_engine`. */
  searchEngine: string
  /** Requested count when the search request carries no `maxResults`; range 1–50. */
  count: number
}

/**
 * Map one structured Z.ai result to a normalized source.
 *
 * @param result - one entry of the response's `search_result[]`.
 * @returns the normalized source; blank fields are omitted rather than set empty.
 */
export function mapZaiResult(result: ZaiSearchResult): WebSearchSource {
  return {
    url: result.link,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    ...result.content != null && result.content.length > 0 ? { snippet: result.content } : {},
    ...result.publish_date != null && result.publish_date.length > 0
      ? { publishedAt: result.publish_date }
      : {},
  }
}

/**
 * Map a Z.ai response envelope to a normalized search result. The API generates no
 * answer text, so `content` is never set.
 *
 * @param response - the parsed web-search response body.
 * @returns the normalized result with `sources[]` from `search_result[]`.
 */
export function mapZaiResponse(response: ZaiSearchResponse): WebSearchResult {
  return {
    sources: response.search_result !== undefined ? response.search_result.map(mapZaiResult) : [],
    truncated: false,
  }
}

/**
 * Clamp a requested result count into the API's accepted `count` range.
 *
 * @param value - the requested count.
 * @returns the value clamped into `[ZAI_MIN_COUNT, ZAI_MAX_COUNT]`.
 */
export function clampZaiCount(value: number): number {
  return Math.min(Math.max(value, ZAI_MIN_COUNT), ZAI_MAX_COUNT)
}

/** The Z.ai-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class ZaiSearchProvider implements WebSearchProvider {
  readonly id = ZAI_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   * once at each operation's entry so one search never mixes two sections. A
   * thunk rather than a value because the plugin's settings section can change
   * between searches, and re-registering the provider to carry a new endpoint
   * would make the seam's selection observable to the user as a flicker.
   */
  constructor(private readonly resolveOptions: () => ZaiSearchProviderOptions) {}

  // Availability checks stay beside each provider's distinct config contract;
  // a shared base class would obscure which fields make this backend usable.
  /* jscpd:ignore-start */
  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && options.searchEngine.length > 0
      && isCountInRange(options.count)
  }
  /* jscpd:ignore-end */

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One snapshot for the whole operation: credential resolution awaits, and a
    // settings write landing inside that await must not send the key resolved
    // from the old section to the endpoint named by the new one.
    const options = this.resolveOptions()
    const apiKey = await this.resolveApiKey(options)
    let response: Response
    try {
      response = await fetch(`${options.baseURL}/web_search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          search_engine: options.searchEngine,
          search_query: request.query,
          count: clampZaiCount(request.maxResults ?? options.count),
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Z.ai search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Z.ai search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Z.ai API error (HTTP ${status})`
      try {
        const parsed = await response.json() as ZaiError
        const detail = parsed.error?.message ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error)) throw new WebError('Z.ai search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as ZaiSearchResponse
      return mapZaiResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Z.ai search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Z.ai returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Resolve the literal key or ask the per-search resolver; a missing key fails the call.
   * @param options - the operation's option snapshot.
   * @returns the key to present to the API.
   * @throws {@link WebError} `WEB_PROVIDER_CREDENTIAL_MISSING` when no source yields a key.
   */
  private async resolveApiKey(options: ZaiSearchProviderOptions): Promise<string> {
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    const resolved = options.resolveApiKey !== undefined ? await options.resolveApiKey() : undefined
    if (resolved !== undefined && resolved.length > 0) return resolved
    throw new WebError(
      `Z.ai search has no API key for "${options.apiKeyEnv}"; store it through the credentials`
        + ' service, or set "apiKey" in the web-search-zai config',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

// These two predicates are intentionally local: exporting generic internals
// from the public web seam would add more API than these pure checks.
/* jscpd:ignore-start */
/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True for a result count the API accepts (a whole number within its 1–50 range). */
function isCountInRange(value: number): boolean {
  return Number.isInteger(value) && value >= ZAI_MIN_COUNT && value <= ZAI_MAX_COUNT
}
/* jscpd:ignore-end */
