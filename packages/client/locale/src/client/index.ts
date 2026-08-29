/**
 * Browser-side dictionary registry. The product ships a single locale:
 * every namespace resolves Russian text, and the shared `common` vocabulary
 * is the fallback after the entry's own namespace misses. Bound translation
 * functions retain stable identity for injected consumers.
 */
/* oxlint-disable typescript/no-redundant-type-constituents --
 * `keyof LocaleNamespaceMap & string` is the declare-merge key pattern (see
 * ui-slots): in THIS unit the map holds only this package's own merges, but
 * consumers merge more namespaces in and the intersection keeps them
 * string-typed. The rule fires on the narrow-map view, not real redundancy. */
import {
  type LocaleDictOf, type LocaleNamespaceMap, type Translate, type TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { ru, type CommonKey } from '../locales/ru.ts'

export type { CommonKey } from '../locales/ru.ts'

// The translate currency lives in ui-slots (the render machinery synthesizes
// the seat); re-exported here so dictionary owners import one package.
// TranslateNS<'model'> is the namespace-addressed developer-facing form.
export type { Translate, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shared cross-feature vocabulary, consulted by the lookup chain after the entry's own namespace misses. */
    common: CommonKey
  }
}

/** Locale dictionary: flat key to template string ({name} placeholders). */
export type LocaleDict = Record<string, string>

/** Immutable registry state published on every change. */
export interface LocaleSnapshot {
  /** Monotonic change counter (dictionary registrations). */
  revision: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    locale: LocaleRuntime
  }
}

/** Shared namespace for shell-level texts. */
export const COMMON_NS = 'common'

/**
 * Dictionary registry. Lookup chain per key: the entry's namespace, then the
 * shared common namespace, then the key itself (missing text stays visible,
 * fail loud in the UI rather than blank). Continuous sync rides the
 * LocaleFace getSnapshot/subscribe pair the render machinery consumes
 * (installed via `ctx.slots.installLocale`); dictionary registrations bump
 * the revision so already rendered outlets pick up late-arriving or removed
 * dictionaries.
 */
export class LocaleRuntime {
  private dicts = new Map<string, LocaleDict>()
  private bound = new Map<string, Translate>()
  private snapshot: LocaleSnapshot = Object.freeze({ revision: 0 })
  private listeners = new Set<() => void>()

  /**
   * The registry needs no context: it emits no cordis events; subscribers
   * (the render machinery's uSES adapter) come from {@link subscribe}.
   */

  /**
   * LocaleFace getSnapshot: the current snapshot (carries `revision`; stable
   * reference between changes, uSES-safe).
   * @returns the current snapshot.
   */
  getSnapshot(): LocaleSnapshot {
    return this.snapshot
  }

  /**
   * LocaleFace subscribe: notified on every snapshot change (dictionary
   * registration or disposal).
   * @param fn - change callback.
   * @returns unsubscribe.
   */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /**
   * Register a namespace's dictionary — the typed form: the dictionary is
   * checked against the namespace's {@link LocaleNamespaceMap} key union (a
   * missing or extra key is a compile error). Duplicate namespace throws
   * (single occupant; a namespace's texts have one owner). Registration
   * bumps the revision so mounted outlets pick up the dictionary.
   * @param ns - a namespace merged into LocaleNamespaceMap.
   * @param dict - the namespace's complete dictionary.
   * @returns disposer removing the dictionary (idempotent).
   */
  register<N extends keyof LocaleNamespaceMap & string>(ns: N, dict: LocaleDictOf<N>): () => void
  /**
   * Untyped form for namespaces outside the merge table (dynamic
   * composition, tests).
   * @param ns - namespace.
   * @param dict - dictionary.
   * @returns disposer (idempotent).
   */
  register(ns: string, dict: LocaleDict): () => void
  register(ns: string, dict: LocaleDict): () => void {
    if (this.dicts.has(ns)) throw new Error(`locale namespace "${ns}" already has a dictionary`)
    this.dicts.set(ns, dict)
    this.publish()
    return () => {
      if (this.dicts.get(ns) === dict) {
        this.dicts.delete(ns)
        this.publish()
      }
    }
  }

  /**
   * Bind a declared namespace to a translate function typed to its
   * dictionary key union (plus the shared common vocabulary) — the same key
   * domain the framework-injected `t` seat carries. The returned reference
   * is stable per namespace (repeat binds return the same function), so it
   * can ride inject surfaces without breaking memoization.
   * @param ns - a namespace merged into LocaleNamespaceMap.
   * @returns the typed translate function.
   */
  bind<N extends keyof LocaleNamespaceMap & string>(ns: N): TranslateNS<N>
  /**
   * Untyped form for namespaces outside the merge table (dynamic
   * composition, tests).
   * @param ns - namespace.
   * @returns the translate function.
   */
  bind(ns: string): Translate
  bind(ns: string): Translate {
    let t = this.bound.get(ns)
    if (!t) {
      t = (key, params) => this.translate(ns, key, params)
      this.bound.set(ns, t)
      return t
    }
    return t
  }

  private translate(ns: string, key: string, params?: Record<string, unknown>): string {
    const template = this.lookup(ns, key)
      ?? (ns !== COMMON_NS ? this.lookup(COMMON_NS, key) : undefined)
      ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }

  private lookup(ns: string, key: string): string | undefined {
    return this.dicts.get(ns)?.[key]
  }

  /**
   * Advance the snapshot revision and notify LocaleFace subscribers (render
   * refresh).
   */
  private publish(): void {
    this.snapshot = Object.freeze({ revision: this.snapshot.revision + 1 })
    for (const fn of [...this.listeners]) {
      try {
        fn()
      } catch (error) {
        // One throwing subscriber must not strand the rest on a stale
        // revision (outlets would keep stale text).
        console.error('locale subscriber crashed:', error)
      }
    }
  }
}

/** Required services: slot registration (the LocaleFace install). */
export const inject = ['slots']

/**
 * Client plugin body: provide the locale service seeded with the common
 * dictionary and install it as the LocaleFace so the render machinery can
 * synthesize the `t` standard seat.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const locale = new LocaleRuntime()
  locale.register(COMMON_NS, ru)
  ctx.provide('locale', locale)
  ctx.slots.installLocale(locale)
}
