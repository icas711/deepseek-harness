/**
 * Service Definition for the web access capability seam (`ctx.web`): registries and provider-selecting execution for search and
 * fetch. Duplicate ids are rejected. At execution time, a configured provider must exist and
 * be usable; without one, exactly one usable provider is required, so selection never depends
 * on registration order. The configured ids resolve on every call through the `web` settings
 * namespace over the compositional entry, so a selection change acts from the next request.
 * @module @deepseek-ai/dsh-web
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from './types.ts'
import { WebError } from './types.ts'

export {
  WebError,
} from './types.ts'
export type {
  WebFetchBody,
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    web: WebRuntime
  }
}

/** Selection inputs for execution-time provider resolution. */
interface Selection<P> {
  /** The configured provider id for this capability, if any. */
  readonly configuredId?: string
  /** Providers registered for this capability kind. */
  readonly providers: ReadonlyMap<string, P>
}

/** Environment variable feeding the compositional search selection. */
const SEARCH_PROVIDER_ENV = 'DSH_WEB_SEARCH_PROVIDER'

/** Environment variable feeding the compositional fetch selection. */
const FETCH_PROVIDER_ENV = 'DSH_WEB_FETCH_PROVIDER'

/**
 * Settings namespace owned here, carrying the `searchProvider` / `fetchProvider`
 * selection a configuration surface edits. Serving it to the web client is a Host
 * allowlist decision, as for every namespace.
 */
export const WEB_SETTINGS_NAMESPACE = settingsNamespace('web')

/**
 * Config for the web seam, doubling as the `web` settings-section schema. The
 * resolved selection layers the user settings section over the compositional entry —
 * the `cordis.yml` fields with `$DSH_WEB_*_PROVIDER` folded in at mount — over the
 * schema default. Operational env overrides feed these SAME fields rather than
 * introduce a hidden priority chain.
 */
export interface WebRuntimeConfig {
  /** Explicit search provider id; empty string or omission = auto-select when exactly one usable. */
  readonly searchProvider?: string
  /** Explicit fetch provider id; empty string or omission = auto-select when exactly one usable. */
  readonly fetchProvider?: string
}

/**
 * The web access service. Registered as `ctx.web` (one instance per context).
 *
 * The configured ids are not fixed at construction: every `search()` / `fetch()`
 * call reads the current `web` settings section — falling back to the compositional
 * entry while no settings service is attached — so a committed change acts from the
 * next request without a restart or re-registration.
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `WEB_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable →
 *   `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `WEB_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `WEB_PROVIDER_UNAVAILABLE`.
 */
export class WebRuntime extends Service {
  /**
   * Plugin config and settings-section schema. The empty-string defaults are the
   * auto-select value a configuration surface renders as the neutral option:
   * schema default → compositional entry → user layer.
   */
  static Config: z<WebRuntimeConfig> = z.object({
    searchProvider: z.string().default(''),
    fetchProvider: z.string().default(''),
  })

  private searchProviders = new Map<string, WebSearchProvider>()
  private fetchProviders = new Map<string, WebFetchProvider>()
  /** Compositional entry: the constructor config with the env overrides folded in. */
  private readonly compositional: WebRuntimeConfig
  /** Currently authoritative selection section; swapped when a settings service attaches. */
  private section: () => WebRuntimeConfig

  constructor(ctx: Context, config: WebRuntimeConfig = {}) {
    super(ctx, 'web')
    const searchProvider = providerId(config.searchProvider) ?? providerId(process.env[SEARCH_PROVIDER_ENV])
    const fetchProvider = providerId(config.fetchProvider) ?? providerId(process.env[FETCH_PROVIDER_ENV])
    this.compositional = {
      ...searchProvider === undefined ? {} : { searchProvider },
      ...fetchProvider === undefined ? {} : { fetchProvider },
    }
    this.section = () => this.compositional
  }

  /**
   * Register the `web` settings namespace over the compositional entry. The source
   * thunk is the whole integration: `search()`/`fetch()` read it per call, so a
   * committed change needs no re-registration, and the injected wiring disposes
   * with this service's fiber.
   */
  protected async [Service.init](): Promise<void> {
    installSettingsSection(this.ctx, WEB_SETTINGS_NAMESPACE, WebRuntime.Config, this.compositional, {
      setSource: (source) => {
        this.section = source
      },
      // Resolution reads the section on every call; nothing derived needs re-judging.
      onChange: () => {},
    })
  }

  /**
   * Register a search provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for search. Returns a disposer; disposed
   * with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerSearchProvider(provider: WebSearchProvider): () => void {
    return this.registerProvider(this.searchProviders, provider)
  }

  /**
   * Register a fetch provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for fetch. Returns a disposer; disposed
   * with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerFetchProvider(provider: WebFetchProvider): () => void {
    return this.registerProvider(this.fetchProviders, provider)
  }

  private registerProvider<P extends { readonly id: string }>(store: Map<string, P>, provider: P): () => void {
    if (store.has(provider.id)) {
      throw new WebError(`a web provider with id "${provider.id}" is already registered`, 'WEB_DUPLICATE_PROVIDER')
    }
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      yield () => store.delete(provider.id)
    }, 'web.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Run one search through the selected provider. Resolves the provider at call
   * time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. The seam enforces `request.maxResults` on the result:
   * if the provider over-returns, `sources[]` is truncated and `truncated` set.
   * @param request - the query and optional result limit.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the provider's results, capped to `request.maxResults`.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const configuredId = providerId(this.section().searchProvider)
    const provider = resolveProvider({
      providers: this.searchProviders,
      ...configuredId === undefined ? {} : { configuredId },
    })
    const result = await provider.search(request, signal)
    return capSources(result, request.maxResults)
  }

  /**
   * Retrieve one URL through the selected provider. Resolves the provider at
   * call time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. A non-2xx response is a result, not a throw.
   * @param request - the URL plus retrieval options.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the retrieval outcome; non-2xx responses resolve descriptively.
   */
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const configuredId = providerId(this.section().fetchProvider)
    const provider = resolveProvider({
      providers: this.fetchProviders,
      ...configuredId === undefined ? {} : { configuredId },
    })
    return provider.fetch(request, signal)
  }
}

interface ResolvableProvider {
  readonly id: string
  available(): boolean
}

/**
 * Read one selection layer's field as an explicit provider id. The schema default
 * and an explicitly stored empty string both mean auto-select.
 * @param value - the field value, when the field is present.
 * @returns the non-empty id, or undefined for auto-select.
 */
function providerId(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined
}

/** Resolve the selected provider or throw the matching {@link WebError}. */
function resolveProvider<P extends ResolvableProvider>(selection: Selection<P>): P {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new WebError(`configured web provider "${configuredId}" is not registered`, 'WEB_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new WebError(`configured web provider "${configuredId}" is registered but unavailable`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new WebError('no usable web provider is registered', 'WEB_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new WebError(`multiple usable web providers are registered (${ids}); configure one explicitly`, 'WEB_PROVIDER_AMBIGUOUS')
  }
  return single
}

/** Enforce `maxResults` on a search result: truncate `sources[]` and flag it. */
function capSources(result: WebSearchResult, maxResults: number | undefined): WebSearchResult {
  if (maxResults === undefined || result.sources.length <= maxResults) return result
  return { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
}

export default WebRuntime
