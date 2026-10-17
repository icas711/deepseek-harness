/**
 * Plugins settings surface, browser half — one section whose feature-owned
 * tabs include configurable Host plugin cards and read-only inventory.
 *
 * The section declares `settings.plugins.tab`; its own `configurable` tab then
 * declares `settings.plugin.item` and renders whatever cards were registered
 * into it. The cards this package ships are the host-plane sections the
 * deployment already exposes; each binds its namespace through the client
 * settings scope, which keeps them unaware of one another and of other tabs.
 * The web-access picker and the web provider cards collaborate through two
 * shared stores: the picker's pick (which provider card is open and
 * highlighted) and the provider cards' published key state (what the picker's
 * warnings read).
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry)
// and the ctx.settingsScope Context merge. Cross-plugin collaboration goes
// through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { AgentLoopCard } from './AgentLoopCard.tsx'
import { BashCard } from './BashCard.tsx'
import { ConfigurablePluginsTab } from './ConfigurablePluginsTab.tsx'
import type { ConfigurablePluginsTabInjected } from './ConfigurablePluginsTab.tsx'
import { PluginsSettingsSection } from './PluginsSettingsSection.tsx'
import type { PluginsSettingsSectionInjected, PluginsSettingsTabEntry } from './PluginsSettingsSection.tsx'
import { ProviderSettingsCard } from './ProviderSettingsCard.tsx'
import { WebAccessCard } from './WebAccessCard.tsx'
import { AGENT_LOOP_NS, AgentLoopCardController } from './agent-loop-card-controller.ts'
import { SHELL_NS, BashCardController } from './bash-card-controller.ts'
import {
  DEEPSEEK_CARD, EXA_CARD, FETCH_HTTP_CARD, PERPLEXITY_CARD, ZAI_CARD,
  WEB_FETCH_HTTP_NS, WEB_SEARCH_DEEPSEEK_NS, WEB_SEARCH_EXA_NS,
  WEB_SEARCH_PERPLEXITY_NS, WEB_SEARCH_ZAI_NS,
  type ExaSearchSettings, type FetchHttpSettings, type PerplexitySearchSettings,
  type WebSearchSettings, type ZaiSearchSettings,
} from './provider-presentations.ts'
import { ProviderCardController, type ProviderCredentialIndex } from './provider-card-controller.ts'
import { WEB_ACCESS_NS, WebAccessCardController, type WebProviderFocus } from './web-access-card-controller.ts'
import { ru } from './locales.ts'

export type { PluginsSettingsSectionInjected, PluginsSettingsSectionProps } from './PluginsSettingsSection.tsx'
export type { ConfigurablePluginsTabInjected, ConfigurablePluginsTabProps } from './ConfigurablePluginsTab.tsx'
export type { PluginCardProps } from './PluginCard.tsx'
export type { SettingsPluginItemOwnerProps } from './slot-contract.ts'
export type { FieldProps } from './fields.tsx'
export type {
  CardActions, CardFieldSpec, CardFieldState, CardSecretSpec, CardShell,
} from './card-form.ts'
export type { AgentLoopCardFace, AgentLoopCardState } from './agent-loop-card-controller.ts'
export type { BashCardFace, BashCardState } from './bash-card-controller.ts'
export type {
  ProviderCardFace, ProviderCardPresentation, ProviderCardState,
} from './provider-card-controller.ts'
export type {
  WebAccessCardFace, WebAccessCardState, WebProviderFocus,
} from './web-access-card-controller.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.plugins'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.pluginInventory', 'settingsScope']

/**
 * Mount the plugin configuration section and the cards this package ships.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, ru), 'ui-settings-plugins: section dictionaries')

  // The picker and the provider cards share these two stores: the pick names
  // which provider card opens and highlights, and the key index feeds the
  // picker's warnings from what the provider cards themselves resolved.
  const providerFocus = createSnapshotStore<WebProviderFocus>({ search: undefined, fetch: undefined })
  const credentialIndex: ProviderCredentialIndex = createSnapshotStore<Readonly<Record<string, boolean>>>({})
  const listModules = async (): Promise<readonly string[]> => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) {
      throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value.entries.map(entry => entry.moduleName)
  }

  const bash = new BashCardController(ctx.settingsScope.bind({ namespace: SHELL_NS }))
  const agentLoop = new AgentLoopCardController(ctx.settingsScope.bind({ namespace: AGENT_LOOP_NS }))
  const webAccess = new WebAccessCardController(ctx.settingsScope.bind({ namespace: WEB_ACCESS_NS }), {
    listModules,
    credentialIndex,
    focus: providerFocus,
  })
  const webSearch = new ProviderCardController<WebSearchSettings>(
    ctx.settingsScope.bind({ namespace: WEB_SEARCH_DEEPSEEK_NS }), api,
    { ...DEEPSEEK_CARD, focus: { store: providerFocus, group: 'search', providerId: 'deepseek-official' },
      credential: { defaultRef: 'DEEPSEEK_API_KEY', index: { store: credentialIndex, key: 'deepseek-official' } } },
  )
  const zai = new ProviderCardController<ZaiSearchSettings>(
    ctx.settingsScope.bind({ namespace: WEB_SEARCH_ZAI_NS }), api,
    { ...ZAI_CARD, focus: { store: providerFocus, group: 'search', providerId: 'zai' },
      credential: { defaultRef: 'ZAI_API_KEY', index: { store: credentialIndex, key: 'zai' } } },
  )
  const exa = new ProviderCardController<ExaSearchSettings>(
    ctx.settingsScope.bind({ namespace: WEB_SEARCH_EXA_NS }), api,
    { ...EXA_CARD, focus: { store: providerFocus, group: 'search', providerId: 'exa' },
      credential: { defaultRef: 'EXA_API_KEY', index: { store: credentialIndex, key: 'exa' } } },
  )
  const perplexity = new ProviderCardController<PerplexitySearchSettings>(
    ctx.settingsScope.bind({ namespace: WEB_SEARCH_PERPLEXITY_NS }), api,
    { ...PERPLEXITY_CARD, focus: { store: providerFocus, group: 'search', providerId: 'perplexity' },
      credential: { defaultRef: 'PERPLEXITY_API_KEY', index: { store: credentialIndex, key: 'perplexity' } } },
  )
  const fetchHttp = new ProviderCardController<FetchHttpSettings>(
    ctx.settingsScope.bind({ namespace: WEB_FETCH_HTTP_NS }), api,
    { ...FETCH_HTTP_CARD, focus: { store: providerFocus, group: 'fetch', providerId: 'http' } },
  )
  const keyCards: { refreshCredential(ref: string): void }[] = [webSearch, zai, exa, perplexity]

  // The credential a card reports is not part of any settings section, so its
  // scope publishes nothing when one is written. This is the only signal that
  // a key written on another surface reached the Host.
  ctx.effect(
    () => ctx.remote.$on('credentials/updated', (ref) => {
      for (const card of keyCards) card.refreshCredential(ref)
    }),
    'ui-settings-plugins: credential invalidations',
  )

  let tabsVersion = -1
  let tabsRevision = -1
  let tabs: readonly PluginsSettingsTabEntry[] = []
  const sectionInjected = (): PluginsSettingsSectionInjected => ({
    hooks: {
      tabs: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.plugins.tab')
          const revision = ctx.locale.getSnapshot().revision
          if (version !== tabsVersion || revision !== tabsRevision) {
            tabsVersion = version
            tabsRevision = revision
            tabs = ctx.slots.entries('settings.plugins.tab')
              .map(entry => ({
                /* v8 ignore next -- list-slot registration requires id */
                id: entry.options.id ?? '',
                order: entry.options.order ?? 0,
                label: resolveSlotLabel(entry.options.label) ?? '',
              }))
              .sort((a, b) => a.order - b.order)
          }
          return tabs
        },
        subscribe: (listener) => {
          const offLedger = ctx.slots.subscribe('settings.plugins.tab', listener)
          const offLocale = ctx.locale.subscribe(listener)
          return () => {
            offLedger()
            offLocale()
          }
        },
      },
    },
  })

  // This package owns the one Plugins navigation entry and the tab chrome;
  // feature plugins contribute pages without competing for Settings nav rows.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'plugins',
    order: 15,
    label: () => t('nav'),
    locale: NS,
    inject: sectionInjected,
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  }, PluginsSettingsSection))

  // The existing configuration page is one ordinary tab. It keeps ownership
  // of the card slot and the card contributions below.
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'configurable',
    order: 0,
    label: () => t('configurableTab'),
    locale: NS,
    inject: (): ConfigurablePluginsTabInjected => ({
      cardCount: ctx.slots.entries('settings.plugin.item').length,
    }),
    children: { 'settings.plugin.item': { kind: 'list', scope: 'root' } },
  }, ConfigurablePluginsTab))

  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'bash',
      order: 0,
      locale: NS,
      inject: () => bash.inject(),
    }, BashCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'agent-loop',
      order: 10,
      locale: NS,
      inject: () => agentLoop.inject(),
    }, AgentLoopCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'web-access',
      order: 15,
      locale: NS,
      inject: () => webAccess.inject(),
    }, WebAccessCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'web-search',
      order: 20,
      locale: NS,
      inject: () => webSearch.inject(),
    }, ProviderSettingsCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'web-zai',
      order: 30,
      locale: NS,
      inject: () => zai.inject(),
    }, ProviderSettingsCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'web-exa',
      order: 40,
      locale: NS,
      inject: () => exa.inject(),
    }, ProviderSettingsCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'web-perplexity',
      order: 50,
      locale: NS,
      inject: () => perplexity.inject(),
    }, ProviderSettingsCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'web-fetch-http',
      order: 60,
      locale: NS,
      inject: () => fetchHttp.inject(),
    }, ProviderSettingsCard)
  })
}
