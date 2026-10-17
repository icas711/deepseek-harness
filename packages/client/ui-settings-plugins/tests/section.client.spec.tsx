// @vitest-environment jsdom
/**
 * What the section and its cards show: the empty line when no plugin
 * contributed one, a card that renders nothing while its namespace is
 * unavailable, and the save footer that decides when staged edits are written.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { AgentLoopCard } from '../src/client/AgentLoopCard.tsx'
import type { AgentLoopCardProps } from '../src/client/AgentLoopCard.tsx'
import { BashCard } from '../src/client/BashCard.tsx'
import type { BashCardProps } from '../src/client/BashCard.tsx'
import { ConfigurablePluginsTab } from '../src/client/ConfigurablePluginsTab.tsx'
import type { ConfigurablePluginsTabProps } from '../src/client/ConfigurablePluginsTab.tsx'
import { PluginsSettingsSection } from '../src/client/PluginsSettingsSection.tsx'
import type { PluginsSettingsSectionProps, PluginsSettingsTabEntry } from '../src/client/PluginsSettingsSection.tsx'
import { ProviderSettingsCard } from '../src/client/ProviderSettingsCard.tsx'
import type { ProviderSettingsCardProps } from '../src/client/ProviderSettingsCard.tsx'
import { WebAccessCard } from '../src/client/WebAccessCard.tsx'
import type { WebAccessCardProps } from '../src/client/WebAccessCard.tsx'
import type { AgentLoopCardState } from '../src/client/agent-loop-card-controller.ts'
import type { BashCardState } from '../src/client/bash-card-controller.ts'
import type { CardFieldState, CardShell } from '../src/client/card-form.ts'
import type { ProviderCardState } from '../src/client/provider-card-controller.ts'
import { ZAI_CARD } from '../src/client/provider-presentations.ts'
import type { WebAccessCardState, WebProviderFocus } from '../src/client/web-access-card-controller.ts'
import { ru } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof ru) => ru[key]

/** A settled form: nothing staged, everything served. */
const settled: CardShell = {
  available: true,
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
}

/** One control's state, defaulting to an inherited value. */
function field(text: string, rest: Partial<CardFieldState> = {}): CardFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

function cardActions() {
  return { edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn() }
}

function renderSection(rows: readonly PluginsSettingsTabEntry[]) {
  const props = {
    t,
    useTabs: (selector: (value: readonly PluginsSettingsTabEntry[]) => unknown) => selector(rows),
    renderSlot: (_name: string, _owner: unknown, options: { only?: string }) => (
      <span>{options.only}</span>
    ),
  } as unknown as PluginsSettingsSectionProps
  render(<PluginsSettingsSection {...props} />)
}

function renderConfigurable(cardCount: number, cards = 'cards') {
  const props = {
    t,
    cardCount,
    renderSlot: () => <li>{cards}</li>,
  } as unknown as ConfigurablePluginsTabProps
  render(<ConfigurablePluginsTab {...props} />)
}

function renderBash(state: Partial<BashCardState> = {}) {
  const store = createSnapshotStore<BashCardState>({
    ...settled,
    timeoutMs: field('60000'),
    maxOutputBytes: field('64000'),
    ...state,
  })
  const actions = cardActions()
  const props = { ...actions, t, useBashCard: bindSnapshotSelector(store) } as unknown as BashCardProps
  render(<BashCard {...props} />)
  return actions
}

describe('PluginsSettingsSection', () => {
  it('says so when no plugin contributed a tab', () => {
    renderSection([])

    expect(screen.getByText(ru.empty)).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('defaults to the first ordered tab and mounts another only after selection', () => {
    renderSection([
      { id: 'configurable', order: 0, label: ru.configurableTab },
      { id: 'all', order: 10, label: 'Список плагинов' },
    ])

    const configurable = screen.getByRole('tab', { name: ru.configurableTab })
    const all = screen.getByRole('tab', { name: 'Список плагинов' })
    expect(configurable.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('configurable')).toBeTruthy()
    expect(screen.queryByText('all')).toBeNull()

    fireEvent.click(all)
    expect(all.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('all')).toBeTruthy()
    expect(screen.getByText('configurable').closest('[role="tabpanel"]')).toHaveProperty('hidden', true)

    fireEvent.click(configurable)
    expect(configurable.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('all').closest('[role="tabpanel"]')).toHaveProperty('hidden', true)
  })

  it('leads with its own heading and intro', () => {
    renderSection([{ id: 'configurable', order: 0, label: ru.configurableTab }])

    expect(screen.getByRole('heading', { name: ru.title })).toBeTruthy()
    expect(screen.getByText(ru.intro)).toBeTruthy()
  })

  it('moves focus and selection with standard horizontal tab keys', () => {
    renderSection([
      { id: 'configurable', order: 0, label: ru.configurableTab },
      { id: 'all', order: 10, label: 'Список плагинов' },
      { id: 'diagnostics', order: 20, label: 'Diagnostics' },
    ])

    const configurable = screen.getByRole('tab', { name: ru.configurableTab })
    const all = screen.getByRole('tab', { name: 'Список плагинов' })
    const diagnostics = screen.getByRole('tab', { name: 'Diagnostics' })
    expect(configurable.getAttribute('tabindex')).toBe('0')
    expect(all.getAttribute('tabindex')).toBe('-1')

    configurable.focus()
    fireEvent.keyDown(configurable, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(all)
    expect(all.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(all, { key: 'End' })
    expect(document.activeElement).toBe(diagnostics)
    fireEvent.keyDown(diagnostics, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(configurable)
    fireEvent.keyDown(configurable, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(diagnostics)
    fireEvent.keyDown(diagnostics, { key: 'Home' })
    expect(document.activeElement).toBe(configurable)

    fireEvent.keyDown(configurable, { key: 'Escape' })
    expect(document.activeElement).toBe(configurable)
    expect(configurable.getAttribute('aria-selected')).toBe('true')
  })
})

describe('ConfigurablePluginsTab', () => {
  it('says so when no plugin contributed a card', () => {
    renderConfigurable(0)

    expect(screen.getByText(ru.empty)).toBeTruthy()
    expect(screen.queryByText('cards')).toBeNull()
  })

  it('renders the card list once a plugin contributed one', () => {
    renderConfigurable(1)

    expect(screen.getByText('cards')).toBeTruthy()
    expect(screen.queryByText(ru.empty)).toBeNull()
  })
})

describe('BashCard', () => {
  it('renders nothing while its namespace is unavailable', () => {
    const { container } = render(<div />)
    renderBash({ available: false })

    expect(container.textContent).toBe('')
    expect(screen.queryByText(ru.bashTitle)).toBeNull()
  })

  it('shows the plugin and reveals its fields only once expanded', () => {
    renderBash()
    expect(screen.getByText(ru.bashTitle)).toBeTruthy()
    expect(screen.queryByLabelText(ru.bashTimeoutMs)).toBeNull()

    fireEvent.click(screen.getByText(ru.bashTitle))

    expect(screen.getByLabelText(ru.bashTimeoutMs)).toBeTruthy()
    expect(screen.getByLabelText(ru.bashMaxOutputBytes)).toBeTruthy()
  })

  it('stages an edit instead of writing it', () => {
    const actions = renderBash()
    fireEvent.click(screen.getByText(ru.bashTitle))

    fireEvent.change(screen.getByLabelText(ru.bashTimeoutMs), { target: { value: '9000' } })

    expect(actions.edit).toHaveBeenCalledWith('timeoutMs', '9000')
    expect(actions.save).not.toHaveBeenCalled()
  })

  it('offers the reset for an overridden field only', () => {
    const actions = renderBash({ timeoutMs: field('9000', { overridden: true }) })
    fireEvent.click(screen.getByText(ru.bashTitle))

    // One badge and one reset: the output cap is still inherited.
    expect(screen.getAllByText(ru.overridden)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: ru.reset }))

    expect(actions.resetField).toHaveBeenCalledWith('timeoutMs')
  })

  it('addresses each of its two fields separately', () => {
    const actions = renderBash({ maxOutputBytes: field('64000', { overridden: true }) })
    fireEvent.click(screen.getByText(ru.bashTitle))

    fireEvent.change(screen.getByLabelText(ru.bashMaxOutputBytes), { target: { value: '1024' } })
    fireEvent.click(screen.getByRole('button', { name: ru.reset }))

    expect(actions.edit).toHaveBeenCalledWith('maxOutputBytes', '1024')
    expect(actions.resetField).toHaveBeenCalledWith('maxOutputBytes')
  })

  it('keeps save and discard inert until something is staged', () => {
    renderBash()
    fireEvent.click(screen.getByText(ru.bashTitle))

    expect(screen.getByRole('button', { name: ru.save })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: ru.discard })).toHaveProperty('disabled', true)
    expect(screen.queryByText(ru.unsaved)).toBeNull()
  })

  it('writes the staged edits when saved, and drops them when discarded', () => {
    const actions = renderBash({ dirty: true, timeoutMs: field('9000', { overridden: true }) })
    fireEvent.click(screen.getByText(ru.bashTitle))

    fireEvent.click(screen.getByRole('button', { name: ru.save }))
    fireEvent.click(screen.getByRole('button', { name: ru.discard }))

    expect(actions.save).toHaveBeenCalledOnce()
    expect(actions.discard).toHaveBeenCalledOnce()
  })

  it('marks a card holding unsaved edits, collapsed or not', () => {
    renderBash({ dirty: true })

    expect(screen.getByText(ru.unsaved)).toBeTruthy()
  })

  it('blocks the save while a draft is invalid, and says why', () => {
    renderBash({ dirty: true, invalid: true, timeoutMs: field('soon', { invalid: true }) })
    fireEvent.click(screen.getByText(ru.bashTitle))

    expect(screen.getByRole('button', { name: ru.save })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: ru.discard })).toHaveProperty('disabled', false)
    expect(screen.getByText(ru.invalidNumber)).toBeTruthy()
  })

  it('reports a save in flight and refuses another', () => {
    renderBash({ dirty: true, saving: true })
    fireEvent.click(screen.getByText(ru.bashTitle))

    expect(screen.getByRole('button', { name: ru.saving })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: ru.discard })).toHaveProperty('disabled', true)
  })

  it('reports a save the deployment did not accept', () => {
    renderBash({ dirty: true, failed: true })
    fireEvent.click(screen.getByText(ru.bashTitle))

    expect(screen.getByText(ru.saveFailed)).toBeTruthy()
  })

  it('says the document is read-only and disables its controls', () => {
    renderBash({ writable: false })
    fireEvent.click(screen.getByText(ru.bashTitle))

    expect(screen.getByRole('status')).toHaveProperty('textContent', ru.readOnly)
    expect(screen.getByLabelText(ru.bashTimeoutMs)).toHaveProperty('disabled', true)
  })

  it('collapses again on a second click', () => {
    renderBash()
    fireEvent.click(screen.getByText(ru.bashTitle))
    expect(screen.getByLabelText(ru.bashTimeoutMs)).toBeTruthy()

    fireEvent.click(screen.getByText(ru.bashTitle))

    expect(screen.queryByLabelText(ru.bashTimeoutMs)).toBeNull()
  })
})

describe('AgentLoopCard', () => {
  it('stages and saves the only field it owns', () => {
    const store = createSnapshotStore<AgentLoopCardState>({
      ...settled,
      dirty: true,
      maxParallelToolCalls: field('10'),
    })
    const actions = cardActions()
    const props = {
      ...actions,
      t,
      useAgentLoopCard: bindSnapshotSelector(store),
    } as unknown as AgentLoopCardProps
    render(<AgentLoopCard {...props} />)

    fireEvent.click(screen.getByText(ru.agentLoopTitle))
    fireEvent.change(screen.getByLabelText(ru.agentLoopMaxParallel), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: ru.save }))

    expect(actions.edit).toHaveBeenCalledWith('maxParallelToolCalls', '2')
    expect(actions.save).toHaveBeenCalledOnce()
  })

  it('stages a reset for the field it owns', () => {
    const store = createSnapshotStore<AgentLoopCardState>({
      ...settled,
      maxParallelToolCalls: field('2', { overridden: true }),
    })
    const actions = cardActions()
    const props = {
      ...actions,
      t,
      useAgentLoopCard: bindSnapshotSelector(store),
    } as unknown as AgentLoopCardProps
    render(<AgentLoopCard {...props} />)

    fireEvent.click(screen.getByText(ru.agentLoopTitle))
    fireEvent.click(screen.getByRole('button', { name: ru.reset }))

    expect(actions.resetField).toHaveBeenCalledWith('maxParallelToolCalls')
  })
})



describe('ProviderSettingsCard', () => {
  function renderProvider(state: Partial<ProviderCardState> = {}, focus: WebProviderFocus = { search: undefined, fetch: undefined }) {
    const store = createSnapshotStore<ProviderCardState>({
      ...settled,
      fields: { baseURL: field(''), searchEngine: field(''), count: field('10') },
      apiKey: field(''),
      apiKeyConfigured: false,
      apiKeyWritable: true,
      ...state,
    })
    const actions = cardActions()
    const focusStore = createSnapshotStore<WebProviderFocus>(focus)
    const props = {
      ...actions,
      t,
      useProviderCard: bindSnapshotSelector(store),
      useWebProviderFocus: bindSnapshotSelector(focusStore),
      presentation: ZAI_CARD.presentation,
      focus: { group: 'search', providerId: 'zai' },
    } as unknown as ProviderSettingsCardProps
    render(<ProviderSettingsCard {...props} />)
    return actions
  }

  it('renders nothing while its namespace is unavailable', () => {
    const { container } = render(<div />)
    renderProvider({ available: false })

    expect(container.textContent).toBe('')
    expect(screen.queryByText(ru.zaiTitle)).toBeNull()
  })

  it('opens and highlights the card the picker picked, without a click', () => {
    renderProvider({}, { search: 'zai', fetch: undefined })

    expect(screen.getByRole('button', { name: new RegExp(ru.zaiTitle) })).toHaveProperty('ariaExpanded', 'true')
  })

  it('keeps another provider collapsed while the pick names a different one', () => {
    renderProvider({}, { search: 'exa', fetch: undefined })

    expect(screen.getByRole('button', { name: new RegExp(ru.zaiTitle) })).toHaveProperty('ariaExpanded', 'false')
  })

  it('reports whether a key is configured without ever showing one', () => {
    renderProvider({ apiKeyConfigured: true })
    fireEvent.click(screen.getByText(ru.zaiTitle))

    expect(screen.getByText(ru.apiKeySet)).toBeTruthy()
    expect(screen.getByLabelText(ru.apiKeyLabel)).toHaveProperty('type', 'password')
  })

  it('keeps the key control usable while the settings document is read-only', () => {
    const actions = renderProvider({ writable: false })
    fireEvent.click(screen.getByText(ru.zaiTitle))

    const key = screen.getByLabelText(ru.apiKeyLabel)
    expect(key).toHaveProperty('disabled', false)
    expect(screen.getByLabelText(ru.zaiBaseUrl)).toHaveProperty('disabled', true)

    fireEvent.change(key, { target: { value: 'zai-secret' } })

    expect(actions.edit).toHaveBeenCalledWith('apiKey', 'zai-secret')
  })

  it('disables the key control when the reference itself is not writable', () => {
    // A key coming from the process environment: the settings document is
    // writable, the credential is not.
    renderProvider({ apiKeyConfigured: true, apiKeyWritable: false })
    fireEvent.click(screen.getByText(ru.zaiTitle))

    expect(screen.getByLabelText(ru.apiKeyLabel)).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(ru.zaiBaseUrl)).toHaveProperty('disabled', false)
  })

  it('stages its presentation fields and their resets', () => {
    const actions = renderProvider({
      fields: {
        baseURL: field('https://api.z.ai/api/paas/v4', { overridden: true }),
        searchEngine: field('search_engine'),
        count: field('5', { overridden: true }),
      },
    })
    fireEvent.click(screen.getByText(ru.zaiTitle))

    fireEvent.change(screen.getByLabelText(ru.zaiSearchEngine), { target: { value: 'web-search' } })
    fireEvent.change(screen.getByLabelText(ru.zaiCount), { target: { value: '20' } })
    const resets = screen.getAllByRole('button', { name: ru.reset })
    expect(resets).toHaveLength(2)
    for (const reset of resets) fireEvent.click(reset)

    expect(actions.edit.mock.calls).toEqual([
      ['searchEngine', 'web-search'],
      ['count', '20'],
    ])
    expect(actions.resetField.mock.calls).toEqual([['baseURL'], ['count']])
  })
})

describe('WebAccessCard', () => {
  function renderWebAccess(state: Partial<WebAccessCardState> = {}) {
    const store = createSnapshotStore<WebAccessCardState>({
      ...settled,
      search: {
        value: field(''),
        options: [
          { id: 'deepseek-official', labelKey: 'webProviderDeepSeek', mounted: true },
          { id: 'zai', labelKey: 'webProviderZai', mounted: true },
          { id: 'exa', labelKey: 'webProviderExa', mounted: false },
          { id: 'perplexity', labelKey: 'webProviderPerplexity', mounted: false },
        ],
      },
      fetch: { value: field(''), options: [{ id: 'http', labelKey: 'webProviderHttp', mounted: false }] },
      keyMissing: false,
      ambiguousAuto: false,
      ...state,
    })
    const actions = { ...cardActions(), onPick: vi.fn() }
    const props = {
      ...actions,
      t,
      useWebAccessCard: bindSnapshotSelector(store),
    } as unknown as WebAccessCardProps
    render(<WebAccessCard {...props} />)
    return actions
  }

  it('renders both groups with every provider and the auto option once expanded', () => {
    renderWebAccess()
    fireEvent.click(screen.getByText(ru.webAccessTitle))

    expect(screen.getByText(ru.webAccessSearchGroup)).toBeTruthy()
    expect(screen.getByText(ru.webAccessFetchGroup)).toBeTruthy()
    for (const key of ['webProviderDeepSeek', 'webProviderZai', 'webProviderExa', 'webProviderPerplexity', 'webProviderHttp'] as const) {
      expect(screen.getByText(ru[key])).toBeTruthy()
    }
    // One «Авто» per group.
    expect(screen.getAllByRole('radio', { name: ru.webAccessAuto })).toHaveLength(2)
  })

  it('names the providers this deployment does not mount', () => {
    renderWebAccess()
    fireEvent.click(screen.getByText(ru.webAccessTitle))

    // Exa, Perplexity, and the HTTP fetch provider are unmounted here.
    expect(screen.getAllByText(ru.webAccessNotMounted)).toHaveLength(3)
    expect(screen.getByRole('radio', { name: ru.webProviderZai })).toBeTruthy()
  })

  it('stages the picked provider instead of writing it', () => {
    const actions = renderWebAccess()
    fireEvent.click(screen.getByText(ru.webAccessTitle))

    // jsdom does not exclude sibling radios on a dispatched click, so the
    // auto-option return gesture is asserted at the controller level.
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(ru.webProviderExa) }))

    expect(actions.onPick).toHaveBeenCalledWith('search', 'exa')
    expect(actions.edit).not.toHaveBeenCalled()
  })

  it('carries the auto option when a provider is picked', () => {
    renderWebAccess({ search: { value: field('zai'), options: [
      { id: 'deepseek-official', labelKey: 'webProviderDeepSeek', mounted: true },
      { id: 'zai', labelKey: 'webProviderZai', mounted: true },
      { id: 'exa', labelKey: 'webProviderExa', mounted: false },
      { id: 'perplexity', labelKey: 'webProviderPerplexity', mounted: false },
    ] } })
    fireEvent.click(screen.getByText(ru.webAccessTitle))

    expect(screen.getByRole('radio', { name: ru.webProviderZai })).toHaveProperty('checked', true)
    expect(screen.getAllByRole('radio', { name: ru.webAccessAuto })[0]).toHaveProperty('checked', false)
  })

  it('warns about a picked provider without a key and about an ambiguous «Авто»', () => {
    renderWebAccess({ keyMissing: true, ambiguousAuto: true })
    fireEvent.click(screen.getByText(ru.webAccessTitle))

    expect(screen.getByText(ru.webAccessKeyMissing)).toBeTruthy()
    expect(screen.getByText(ru.webAccessAmbiguous)).toBeTruthy()
  })

  it('says nothing while no warning applies', () => {
    renderWebAccess()
    fireEvent.click(screen.getByText(ru.webAccessTitle))

    expect(screen.queryByText(ru.webAccessKeyMissing)).toBeNull()
    expect(screen.queryByText(ru.webAccessAmbiguous)).toBeNull()
  })

  it('disables every radio while the document is read-only', () => {
    renderWebAccess({ writable: false })
    fireEvent.click(screen.getByText(ru.webAccessTitle))

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveProperty('disabled', true)
    }
  })
})
