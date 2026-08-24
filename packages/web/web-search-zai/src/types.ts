/**
 * Wire types for the Z.ai Web Search API (`POST https://api.z.ai/api/paas/v4/web_search`).
 * The endpoint returns structured results with no generated answer; the wire shape is
 * provider-private and does not depend on `ctx.llm`.
 * @module @deepseek-ai/dsh-web-search-zai/types
 */

/** Request body sent to the Z.ai web-search endpoint. */
export interface ZaiSearchRequest {
  /** Search engine tier; the API rejects an empty value (HTTP 400 code 1214). */
  search_engine: string
  /** The query verbatim. */
  search_query: string
  /** Requested result count; range 1–50, API default 10. */
  count?: number
}

/** One structured search result. */
export interface ZaiSearchResult {
  /** Result title. */
  title?: string | null
  /** Page summary; maps to the seam's `snippet`. */
  content?: string | null
  /** Result URL; maps to the seam's `url`. */
  link: string
  /** Publisher or site name. */
  media?: string | null
  /** Favicon URL. */
  icon?: string | null
  /** Provider-internal reference marker. */
  refer?: string | null
  /** Publication date; maps to the seam's `publishedAt`. */
  publish_date?: string | null
}

/** Z.ai's response envelope. */
export interface ZaiSearchResponse {
  id?: string
  created?: number
  search_result?: ZaiSearchResult[]
}

/** Z.ai's error response envelope (best-effort; fields vary). */
export interface ZaiError {
  error?: { code?: string | number; message?: string }
  code?: string | number
  message?: string
}
