/**
 * The staged form behind every provider settings card, generalized over the
 * settings namespace: one card binds one namespace, stages its edits, and
 * writes them on save.
 *
 * A provider that resolves a key gets the one control that does not live in
 * the section: its literal never rides a response, so the card learns only
 * whether one is configured and writes it through the credentials domain,
 * addressed by the reference the section names. The answer is published to a
 * shared index keyed by the seam provider id, so the web-access picker warns
 * about a selection without querying the credentials domain itself. A
 * provider without a key omits the credential options and carries no such
 * control.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm,
  type CardActions, type CardFieldSpec, type CardFieldState, type CardShell,
} from './card-form.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import type { WebProviderFocus } from './web-access-card-controller.ts'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** The provider cards' published key state, keyed by seam provider id. */
export type ProviderCredentialIndex = SnapshotStore<Readonly<Record<string, boolean>>>

/** Credential control wiring for a provider that resolves a key. */
export interface ProviderCredentialOptions {
  /** Reference the provider resolves when the section names none. */
  defaultRef: string
  /** Where this card publishes its key state, under the seam provider id. */
  index?: { store: ProviderCredentialIndex; key: string }
}

/** Presentation copy for one section field of a provider card. */
export interface ProviderFieldPresentation {
  /** Field name inside the namespace section. */
  field: string
  /** Locale key of the visible label. */
  labelKey: PluginsSettingsLocaleKey
  /** Locale key of the one-line explanation rendered under the control. */
  hintKey: PluginsSettingsLocaleKey
  /** Hints a numeric keypad. */
  numeric?: boolean
}

/** The credential control's copy keys. */
export interface ProviderCredentialPresentation {
  /** Locale key of the visible label. */
  labelKey: PluginsSettingsLocaleKey
  /** Locale key of the one-line explanation. */
  hintKey: PluginsSettingsLocaleKey
  /** Locale key shown while the Host reports a configured credential. */
  configuredKey: PluginsSettingsLocaleKey
  /** Locale key shown while it reports none. */
  missingKey: PluginsSettingsLocaleKey
}

/** Static presentation of one provider card: its copy keys and its fields. */
export interface ProviderCardPresentation {
  /** Locale key of the plugin's name. */
  titleKey: PluginsSettingsLocaleKey
  /** Locale key of the line describing what these settings govern. */
  descriptionKey: PluginsSettingsLocaleKey
  /** The section fields this card renders, in display order. */
  fields: readonly ProviderFieldPresentation[]
  /** The credential control's copy, when the provider resolves a key. */
  credential?: ProviderCredentialPresentation
}

/** What a provider card renders. */
export interface ProviderCardState extends CardShell {
  /** The card's section fields, keyed by field name. */
  fields: Readonly<Record<string, CardFieldState>>
  /** The staged credential, which starts blank on every load. */
  apiKey: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
}

/** The registration-side face a provider card's slot entry injects. */
export interface ProviderCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useProviderCard. */
    providerCard: SnapshotStore<ProviderCardState>
    /** The picker's current pick, bound as useWebProviderFocus. */
    webProviderFocus: SnapshotStore<WebProviderFocus>
  }
  /** This card's static copy keys and display fields. */
  presentation: ProviderCardPresentation
  /** Which picker group and seam provider id open and highlight this card. */
  focus: { group: 'search' | 'fetch'; providerId: string }
}

/** Constructor wiring of one provider card. */
export interface ProviderCardControllerOptions {
  /** The section fields this card edits. */
  fields: CardFieldSpec[]
  /** The credential control's wiring; omit for a provider without a key. */
  credential?: ProviderCredentialOptions
  /** The card's static copy keys and display fields. */
  presentation: ProviderCardPresentation
  /** Where the picker's pick lands, and which pick this card answers to. */
  focus: { store: SnapshotStore<WebProviderFocus>; group: 'search' | 'fetch'; providerId: string }
}

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials.set` can affect it; false disables the control. */
  writable: boolean
}

/**
 * Bridge one provider's settings scope and the credentials domain onto its card.
 * @typeParam T - the namespace's section document.
 */
export class ProviderCardController<T extends object> {
  private readonly form: CardForm<T>
  private readonly store: SnapshotStore<ProviderCardState>
  private readonly fieldNames: readonly string[]
  private readonly credentialOptions: ProviderCredentialOptions | undefined
  private readonly focus: ProviderCardControllerOptions['focus']
  private readonly presentation: ProviderCardPresentation
  private credential: CredentialState

  /**
   * @param scope - the bound settings scope for this provider's namespace.
   * @param api - wire face used for the credential the section references.
   * @param options - the card's fields, credential wiring, copy, and pick.
   */
  constructor(
    private readonly scope: SettingsScope<T>,
    private readonly api: Pick<IApiClient, 'credentials'>,
    options: ProviderCardControllerOptions,
  ) {
    this.credentialOptions = options.credential
    this.focus = options.focus
    this.presentation = options.presentation
    this.credential = { ref: '', configured: false, writable: true }
    this.fieldNames = options.presentation.fields.map(field => field.field)
    this.form = new CardForm(
      scope,
      options.fields,
      options.credential === undefined ? [] : [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    if (options.credential !== undefined) {
      scope.subscribe(() => { void this.readCredential() })
      void this.readCredential()
    }
  }

  private projection(): ProviderCardState {
    const fields: Record<string, CardFieldState> = {}
    for (const field of this.fieldNames) fields[field] = this.form.field(field)
    return {
      ...this.form.shell(),
      fields,
      apiKey: this.credentialOptions === undefined
        ? { text: '', overridden: false, invalid: false }
        : this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  /**
   * Ask the credentials domain about the reference the section currently names.
   *
   * The answer is stored with the reference it describes: `apiKeyEnv` can
   * change between the request and its response, and two reads can settle out
   * of order, so a response is published only while it still answers for the
   * reference in force.
   */
  private async readCredential(): Promise<void> {
    const credential = this.credentialOptions
    if (credential === undefined) return
    const ref = refOf(this.scope.getSnapshot(), credential.defaultRef)
    if (ref !== this.credential.ref) {
      // A new reference knows nothing yet; keeping the old answer would claim
      // the key is configured under a name nobody has checked.
      this.credential = { ref, configured: false, writable: true }
      this.publishIndex(false)
      this.store.set(this.projection())
    }
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs: [ref] })
    } catch (_credentialReadFailure) {
      // The card stays usable without this: the key control simply reports the
      // last state it knew, and a write still reaches the Host.
      return
    }
    if (!response.result.ok || ref !== refOf(this.scope.getSnapshot(), credential.defaultRef)) return
    const view = response.result.value.credentials[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      // An unknown reference is treated as writable: the control stays usable
      // and the Host is what refuses, rather than the card guessing a refusal.
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.publishIndex(next.configured)
    this.store.set(this.projection())
  }

  /**
   * Publish this card's key state to the shared index under the seam provider
   * id, so the web-access picker's warnings read what the provider card itself
   * resolved rather than querying the credentials domain a second time.
   * @param configured - whether a key is configured for the current reference.
   */
  private publishIndex(configured: boolean): void {
    const index = this.credentialOptions?.index
    if (index === undefined) return
    const snapshot = index.store.getSnapshot()
    if (snapshot[index.key] === configured) return
    index.store.set({ ...snapshot, [index.key]: configured })
  }

  /**
   * Re-read after the Host reports a change to the reference this card watches.
   *
   * A key can be written from somewhere else — the Models page addresses the
   * same reference — and the settings section does not change when it is, so
   * without this the badge keeps reporting a state the Host already replaced.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot, its form actions, and its static presentation.
   */
  inject(): ProviderCardFace {
    return {
      hooks: {
        providerCard: this.store,
        webProviderFocus: this.focus.store,
      },
      ...this.form.actions(),
      presentation: this.presentation,
      focus: { group: this.focus.group, providerId: this.focus.providerId },
    }
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    const credential = this.credentialOptions
    if (credential === undefined) return false
    try {
      await this.api.credentials.set({ ref: refOf(this.scope.getSnapshot(), credential.defaultRef), value })
    } catch (_credentialWriteFailure) {
      // Refusals surface through the re-read below: the Host is the only
      // authority on whether the key now exists.
    }
    await this.readCredential()
    return this.credential.configured
  }
}

/**
 * The credential reference the section names, or the provider's default.
 * @param snapshot - the current scope snapshot.
 * @param fallback - the provider's default reference.
 * @returns the reference to address.
 */
function refOf<T extends object>(snapshot: SettingsScopeSnapshot<T>, fallback: string): string {
  const declared = (snapshot.value as { apiKeyEnv?: unknown } | undefined)?.apiKeyEnv
  return typeof declared === 'string' && declared.length > 0 ? declared : fallback
}
