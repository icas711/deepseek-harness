/** What the browser half registers, and that it all leaves with the fiber. */

import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {
  ConfigurablePluginsTabInjected, PluginsSettingsSectionInjected,
} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

const CARD_IDS = ['bash', 'agent-loop', 'web-access', 'web-search', 'web-zai', 'web-exa', 'web-perplexity', 'web-fetch-http']
const PROVIDER_CARD_IDS = ['web-search', 'web-zai', 'web-exa', 'web-perplexity', 'web-fetch-http']

/**
 * The `remote` double, in one service: the forwarded-event handoff the
 * connection sink mirrors, plus the tracked identity the property proxy needs
 * to answer the dotted `ctx.remote.pluginInventory` namespace.
 */
class RemoteServiceDouble extends Service {
  private readonly listeners = new Map<string, Set<(...args: never[]) => void>>()

  constructor(ctx: Context) {
    super(ctx, 'remote')
  }

  $dispatch(event: string, args: readonly unknown[]): void {
    const listeners = this.listeners.get(event)
    if (listeners === undefined) return
    for (const listener of [...listeners]) listener(...args as never[])
  }

  $on(event: string, listener: (...args: never[]) => void): () => void {
    const listeners = this.listeners.get(event) ?? new Set()
    this.listeners.set(event, listeners)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime()
  ctx.provide('locale', locale)
  const describeCredentials = vi.fn(() => Promise.resolve({ rpcId: 'c', result: { ok: false, error: {} } }))
  // The section binds its scopes through the Settings surface's service, and
  // forwarded Host events reach the cards through the same `$dispatch`
  // handoff the connection sink makes. The constructor provides the service.
  new RemoteServiceDouble(ctx)
  ctx.provide('connection', {
    isLoopback: true,
    api: {
      settings: { describe: vi.fn(() => Promise.resolve({ rpcId: 's', result: { ok: false, error: {} } })) },
      credentials: { describe: describeCredentials },
    },
  } as never)
  const listInventory = vi.fn(() => Promise.resolve({ ok: true as const, value: { entries: [] } }))
  ctx.provide('remote.pluginInventory', { list: listInventory })
  await ctx.plugin(SettingsScopeBinder).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, describeCredentials, listInventory }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-plugins apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'remote.pluginInventory', 'settingsScope'])
  })

  it('registers one Plugins section and declares the tab and card slots', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    expect(section.options).toMatchObject({ id: 'plugins', order: 15 })
    // The nav label is a thunk; owners resolve it at read time.
    expect(resolveSlotLabel(section.options.label)).toBe('Плагины')
    expect(slots.spec('settings.plugins.tab')).toMatchObject({ kind: 'list', scope: 'root' })
    const tab = slots.entries('settings.plugins.tab')[0]!
    expect(tab.options).toMatchObject({ id: 'configurable', order: 0 })
    expect(resolveSlotLabel(tab.options.label)).toBe('Конфигурация плагинов')
    expect(slots.spec('settings.plugin.item')).toMatchObject({ kind: 'list', scope: 'root' })
  })

  it('registers one card per host-plane section it ships, with the picker above the provider cards', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(slots.entries('settings.plugin.item').map(entry => entry.options.id))
      .toEqual(CARD_IDS)
    const orders = new Map(slots.entries('settings.plugin.item').map(entry => [entry.options.id, entry.options.order]))
    expect(orders.get('web-access')).toBeLessThan(orders.get('web-search') as number)
    expect(orders.get('web-search')).toBeLessThan(orders.get('web-zai') as number)
  })

  it('reads the plugin inventory once for the picker', async () => {
    const { ctx, slots, listInventory } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(listInventory).toHaveBeenCalledOnce() })

    // A settings write changes no mounted plugin, so the picker does not re-read.
    slots.entries('settings.plugin.item')[0]!.inject?.()

    expect(listInventory).toHaveBeenCalledOnce()
  })

  it('injects a live tab projection, a card count, and one business face per card', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    const sectionFace = (section.inject as unknown as () => PluginsSettingsSectionInjected)()
    const initialTabs = sectionFace.hooks.tabs.getSnapshot()
    expect(initialTabs).toEqual([
      { id: 'configurable', order: 0, label: 'Конфигурация плагинов' },
    ])
    expect(sectionFace.hooks.tabs.getSnapshot()).toBe(initialTabs)

    const listener = vi.fn()
    const unsubscribe = sectionFace.hooks.tabs.subscribe(listener)
    slots.register({ name: 'settings.plugins.tab', id: 'plain' } as never, () => null)
    expect(sectionFace.hooks.tabs.getSnapshot()).toEqual([
      { id: 'configurable', order: 0, label: 'Конфигурация плагинов' },
      { id: 'plain', order: 0, label: '' },
    ])
    unsubscribe()

    const tab = slots.entries('settings.plugins.tab')[0]!
    expect((tab.inject as unknown as () => ConfigurablePluginsTabInjected)()).toEqual({ cardCount: 8 })

    const faces = new Map(slots.entries('settings.plugin.item').map(entry => [entry.options.id as string,
      (entry as { inject?: () => unknown }).inject?.() as { hooks: Record<string, unknown> }]))
    expect(Object.keys(faces.get('bash')!.hooks)).toEqual(['bashCard'])
    expect(Object.keys(faces.get('agent-loop')!.hooks)).toEqual(['agentLoopCard'])
    expect(Object.keys(faces.get('web-access')!.hooks)).toEqual(['webAccessCard'])
    for (const id of PROVIDER_CARD_IDS) {
      expect(Object.keys(faces.get(id)!.hooks)).toEqual(['providerCard', 'webProviderFocus'])
    }
    // One pick store behind every provider card: a pick opens exactly one card.
    const focusStores = PROVIDER_CARD_IDS.map(id => faces.get(id)!.hooks.webProviderFocus)
    expect(new Set(focusStores).size).toBe(1)
  })

  it('stages a picker pick on the picker face without writing', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const entry = slots.entries('settings.plugin.item').find(item => item.options.id === 'web-access')!
    const face = (entry as { inject?: () => unknown }).inject?.() as {
      hooks: { webAccessCard: { getSnapshot(): { search: { value: { text: string } } } } }
      onPick: (group: 'search' | 'fetch', id: string) => void
    }
    face.onPick('search', 'zai')

    expect(face.hooks.webAccessCard.getSnapshot().search.value.text).toBe('zai')
  })

  it('re-reads the credential when the Host reports the watched reference changed', async () => {
    const { ctx, slots, describeCredentials } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeCredentials).toHaveBeenCalled() })
    describeCredentials.mockClear()

    // A key written on another surface changes no settings section, so this
    // event is the only thing that reaches the card.
    ctx.remote.$dispatch('credentials/updated', ['DEEPSEEK_API_KEY'])

    await vi.waitFor(() => { expect(describeCredentials).toHaveBeenCalledTimes(1) })
  })

  it('ignores a credential change for a reference no card watches', async () => {
    const { ctx, slots, describeCredentials } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeCredentials).toHaveBeenCalled() })
    describeCredentials.mockClear()

    ctx.remote.$dispatch('credentials/updated', ['SOME_OTHER_KEY'])
    await Promise.resolve()

    expect(describeCredentials).not.toHaveBeenCalled()
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    declareRoot(slots)

    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
  })

  it('collapses every contribution on teardown', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.plugin.item')).toHaveLength(CARD_IDS.length)

    await fiber.dispose()

    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(slots.spec('settings.plugins.tab')).toBeUndefined()
    expect(slots.spec('settings.plugin.item')).toBeUndefined()
  })
})
