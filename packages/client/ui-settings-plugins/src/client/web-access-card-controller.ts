/**
 * The web-access picker's staged form over the `web` settings namespace.
 *
 * The card is the seam's selection surface: one radio list for search and one
 * for fetch, each with the empty-string «Авто» option. Which providers exist
 * is a product fact spelled here — a client package must not depend on a Host
 * package — while each option's mounted state comes from the Host plugin
 * inventory and its key state from what the provider cards themselves
 * resolved, so both stay honest about the deployment this page runs in.
 *
 * The picker's current pick lands in a shared focus store, which opens and
 * highlights the matching provider card. Only an explicit pick moves it: the
 * composed selection a page loads with is a fact to display, not a gesture to
 * replay.
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { CardForm, textField, type CardActions, type CardFieldState, type CardShell } from './card-form.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import type { ProviderCredentialIndex } from './provider-card-controller.ts'

/**
 * Namespace of the web seam's provider selection. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const WEB_ACCESS_NS = 'web'

/** The selection fields this card edits. */
export interface WebAccessSettings {
  /** Explicit search provider id; empty = auto-select. */
  searchProvider?: string
  /** Explicit fetch provider id; empty = auto-select. */
  fetchProvider?: string
}

/** One picker option as this module knows it statically. */
export interface WebProviderInfo {
  /** The seam's provider id, stored as the selection value. */
  id: string
  /** Locale key of the option's visible name. */
  labelKey: PluginsSettingsLocaleKey
  /** The plugin package whose mount carries this provider. */
  moduleName: string
}

/** Every search provider the seam knows, in display order. */
export const WEB_SEARCH_PROVIDERS: readonly WebProviderInfo[] = [
  { id: 'deepseek-official', labelKey: 'webProviderDeepSeek', moduleName: '@deepseek-ai/dsh-web-search-deepseek' },
  { id: 'zai', labelKey: 'webProviderZai', moduleName: '@deepseek-ai/dsh-web-search-zai' },
  { id: 'exa', labelKey: 'webProviderExa', moduleName: '@deepseek-ai/dsh-web-search-exa' },
  { id: 'perplexity', labelKey: 'webProviderPerplexity', moduleName: '@deepseek-ai/dsh-web-search-perplexity' },
]

/** Every fetch provider the seam knows. */
export const WEB_FETCH_PROVIDERS: readonly WebProviderInfo[] = [
  { id: 'http', labelKey: 'webProviderHttp', moduleName: '@deepseek-ai/dsh-web-fetch-http' },
]

/** Which provider card the picker's last pick opens, per capability. */
export interface WebProviderFocus {
  /** The picked search provider id, or undefined for «Авто» / no pick yet. */
  search: string | undefined
  /** The picked fetch provider id, or undefined for «Авто» / no pick yet. */
  fetch: string | undefined
}

/** One radio option as a picker group renders it. */
export interface WebProviderOptionState {
  /** The seam's provider id, the radio's value. */
  id: string
  /** Locale key of the option's visible name. */
  labelKey: PluginsSettingsLocaleKey
  /** Whether this deployment mounts the provider's plugin. */
  mounted: boolean
}

/** One picker group as the card renders it. */
export interface WebProviderGroupState {
  /** The staged-or-effective selection; the empty string is «Авто». */
  value: CardFieldState
  /** Every option, including the ones this deployment does not mount. */
  options: readonly WebProviderOptionState[]
}

/** What the web-access card renders. */
export interface WebAccessCardState extends CardShell {
  /** The search picker. */
  search: WebProviderGroupState
  /** The fetch picker. */
  fetch: WebProviderGroupState
  /** Whether the explicitly selected search provider has no configured key. */
  keyMissing: boolean
  /**
   * Whether «Авто» faces several usable search providers — a selection the
   * seam refuses with WEB_PROVIDER_AMBIGUOUS at the next search.
   */
  ambiguousAuto: boolean
}

/** The registration-side face the web-access card's slot entry injects. */
export interface WebAccessCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useWebAccessCard. */
    webAccessCard: SnapshotStore<WebAccessCardState>
  }
  /** Stage one group's selection and open the matching provider card. */
  onPick: (group: 'search' | 'fetch', id: string) => void
}

/** Constructor wiring of the web-access card. */
export interface WebAccessCardControllerOptions {
  /** Read the Host inventory's mounted module names. */
  listModules: () => Promise<readonly string[]>
  /** The provider cards' published key state, by seam provider id. */
  credentialIndex: ProviderCredentialIndex
  /** Where the picker's pick lands. */
  focus: SnapshotStore<WebProviderFocus>
}

/**
 * Bridge the `web` selection scope, the plugin inventory, and the provider
 * cards' key state onto the picker card.
 */
export class WebAccessCardController {
  private readonly form: CardForm<WebAccessSettings>
  private readonly store: SnapshotStore<WebAccessCardState>
  private modules: ReadonlySet<string> = new Set()
  private modulesKnown = false

  /** @param scope - the bound settings scope for the `web` namespace. @param options - inventory, key-state, and focus wiring. */
  constructor(
    scope: SettingsScope<WebAccessSettings>,
    private readonly options: WebAccessCardControllerOptions,
  ) {
    this.form = new CardForm(scope, [textField('searchProvider'), textField('fetchProvider')])
    this.store = this.form.bind(() => this.projection())
    // The key state lands after this card mounts: each provider card resolves
    // its reference asynchronously, and the warnings read that index.
    this.options.credentialIndex.subscribe(() => { this.store.set(this.projection()) })
    void this.readInventory()
  }

  private projection(): WebAccessCardState {
    const search = this.form.field('searchProvider')
    const fetch = this.form.field('fetchProvider')
    const configured = this.options.credentialIndex.getSnapshot()
    const usable = WEB_SEARCH_PROVIDERS.filter(info => this.mounted(info) && configured[info.id] === true)
    return {
      ...this.form.shell(),
      search: { value: search, options: WEB_SEARCH_PROVIDERS.map(info => this.option(info)) },
      fetch: { value: fetch, options: WEB_FETCH_PROVIDERS.map(info => this.option(info)) },
      keyMissing: search.text !== '' && configured[search.text] === false,
      ambiguousAuto: search.text === '' && usable.length > 1,
    }
  }

  /**
   * Stage one group's selection and open the matching provider card.
   * @param group - which capability the pick addresses.
   * @param id - the picked provider id; the empty string is «Авто».
   */
  private pick(group: 'search' | 'fetch', id: string): void {
    this.form.actions().edit(group === 'search' ? 'searchProvider' : 'fetchProvider', id)
    const current = this.options.focus.getSnapshot()
    const next: WebProviderFocus = {
      search: group === 'search' ? (id === '' ? undefined : id) : current.search,
      fetch: group === 'fetch' ? (id === '' ? undefined : id) : current.fetch,
    }
    this.options.focus.set(next)
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot, its form actions, and the pick handler.
   */
  inject(): WebAccessCardFace {
    return {
      hooks: { webAccessCard: this.store },
      ...this.form.actions(),
      onPick: (group, id) => { this.pick(group, id) },
    }
  }

  /**
   * Read the Host inventory once and keep its answer: a deployment mounts its
   * plugins at boot, so the mounted set does not trail the settings document.
   * A failed read keeps the last knowledge — and until any read lands, every
   * option renders mounted, because greying a provider the deployment runs
   * would state the opposite of the truth.
   */
  private async readInventory(): Promise<void> {
    let names: readonly string[]
    try {
      names = await this.options.listModules()
    } catch (_inventoryReadFailure) {
      return
    }
    const modules = new Set(names)
    if (this.modulesKnown && sameModules(this.modules, modules)) return
    this.modules = modules
    this.modulesKnown = true
    this.store.set(this.projection())
  }

  private option(info: WebProviderInfo): WebProviderOptionState {
    return { id: info.id, labelKey: info.labelKey, mounted: this.mounted(info) }
  }

  private mounted(info: WebProviderInfo): boolean {
    return !this.modulesKnown || mountsProvider(this.modules, info.moduleName)
  }
}

/** Whether the mounted module names carry one provider's plugin. */
function mountsProvider(names: ReadonlySet<string>, moduleName: string): boolean {
  for (const name of names) {
    if (name === moduleName || name.startsWith(moduleName + '/')) return true
  }
  return false
}

/** Whether two mounted-name sets answer the same. */
function sameModules(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const name of a) {
    if (!b.has(name)) return false
  }
  return true
}
