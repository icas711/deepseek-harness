// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import {
  createSnapshotStore, type SessionListState, type SettingsScopeSnapshot, type WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { parseRetryDraft, resolvedPolicy, RetrySettingsRow } from '../src/client/RetrySettingsRow.tsx'
import type { RetrySettingsRowProps } from '../src/client/RetrySettingsRow.tsx'
import { ru } from '../src/client/locales.ts'

afterEach(cleanup)

const RESOLVED_SECTION = {
  retryPolicy: {
    mode: 'normal',
    maxRetries: 5,
    retryableCodes: ['RATE_LIMIT'],
    backoff: { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0.1 },
  },
}

function scopeSnapshot(overrides: Partial<SettingsScopeSnapshot<unknown>> = {}): SettingsScopeSnapshot<unknown> {
  return {
    status: 'ready',
    value: RESOLVED_SECTION,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
    ...overrides,
  }
}

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }))
}

interface Harness {
  props: RetrySettingsRowProps
  save: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
  store: ReturnType<typeof createSnapshotStore<SettingsScopeSnapshot<unknown>>>
  rerender: (snapshot: SettingsScopeSnapshot<unknown>) => void
}

function mount(snapshot: SettingsScopeSnapshot<unknown> = scopeSnapshot()): Harness {
  const store = createSnapshotStore<SettingsScopeSnapshot<unknown>>(snapshot)
  const save = vi.fn(async () => undefined)
  const reset = vi.fn(async () => undefined)
  const props: RetrySettingsRowProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useProvider: bindSnapshotSelector(store),
    saveRetryPolicy: save,
    resetRetryPolicy: reset,
    t: makeTranslate(ru),
  }
  const view = render(<RetrySettingsRow {...props} />)
  return {
    props,
    save,
    reset,
    store,
    rerender: (next) => {
      store.set(next)
      view.rerender(<RetrySettingsRow {...props} />)
    },
  }
}

const input = (label: string): HTMLInputElement =>
  screen.getByRole('textbox', { name: label }) as HTMLInputElement

function edit(label: string, value: string): void {
  fireEvent.change(input(label), { target: { value } })
}

describe('RetrySettingsRow', () => {
  it('renders the resolved policy values and gates Apply on an edit', () => {
    mount()
    expect(screen.getByText('Повторы при ошибках модели')).toBeDefined()
    expect(input('Число повторов').value).toBe('5')
    expect(input('Начальная пауза, мс').value).toBe('500')
    expect(input('Макс. пауза, мс').value).toBe('10000')
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Сбросить' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('saves the parsed draft, reports success, and returns to the resolved values', async () => {
    const b = mount()
    edit('Число повторов', '7')
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    await waitFor(() => {
      expect(b.save).toHaveBeenCalledWith({ maxRetries: 7, initialDelayMs: 500, maxDelayMs: 10_000 })
    })
    expect(await screen.findByText('Сохранено. Применяется к следующим запросам.')).toBeDefined()
    expect(input('Число повторов').value).toBe('5')
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('surfaces a failed save and keeps the draft editable', async () => {
    const b = mount()
    b.save.mockResolvedValue('settings-rejected: backoff.maxDelayMs')
    edit('Макс. пауза, мс', '20000')
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(await screen.findByText('settings-rejected: backoff.maxDelayMs')).toBeDefined()
    expect(input('Макс. пауза, мс').value).toBe('20000')
  })

  it('surfaces a transport rejection from the save face', async () => {
    const b = mount()
    b.save.mockRejectedValueOnce('сеть недоступна').mockRejectedValueOnce(new TypeError('fetch failed'))
    edit('Макс. пауза, мс', '20000')
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(await screen.findByText('сеть недоступна')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(await screen.findByText('fetch failed')).toBeDefined()
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(false)
    expect(input('Макс. пауза, мс').value).toBe('20000')
  })

  it('surfaces a failed reset and keeps the row editable', async () => {
    const b = mount()
    b.reset.mockResolvedValue('settings-conflict')
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(await screen.findByText('settings-conflict')).toBeDefined()
    expect(input('Число повторов').disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Сбросить' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('surfaces a transport rejection from the reset face', async () => {
    const b = mount()
    b.reset.mockRejectedValueOnce(new Error('broken pipe')).mockRejectedValueOnce('offline')
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(await screen.findByText('broken pipe')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(await screen.findByText('offline')).toBeDefined()
    expect(b.save).not.toHaveBeenCalled()
  })

  it('offers the editable schema defaults when the ready section carries no policy yet', () => {
    mount(scopeSnapshot({ value: {} }))
    expect(input('Число повторов').value).toBe('5')
    expect(input('Начальная пауза, мс').value).toBe('500')
    expect(input('Макс. пауза, мс').value).toBe('10000')
    expect(input('Число повторов').disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(true)
    edit('Число повторов', '2')
    expect(input('Начальная пауза, мс').value).toBe('500')
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('rejects non-integer or inverted pauses locally without a write', () => {
    const b = mount()
    edit('Начальная пауза, мс', '0.5')
    expect(screen.getByText('Введите целые неотрицательные числа; начальная пауза не больше максимальной.')).toBeDefined()
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(true)
    expect(b.save).not.toHaveBeenCalled()

    edit('Начальная пауза, мс', '50000')
    expect(screen.getByText('Введите целые неотрицательные числа; начальная пауза не больше максимальной.')).toBeDefined()
    expect(b.save).not.toHaveBeenCalled()
  })

  it('disables editing when the resolved policy is always mode', () => {
    mount(scopeSnapshot({
      value: { retryPolicy: { mode: 'always', backoff: { initialDelayMs: 1000, maxDelayMs: 30_000, jitterRatio: 0.2 } } },
    }))
    expect(screen.getByText('В конфигурации действует режим «повторять всегда»: ограничение числа повторов недоступно.')).toBeDefined()
    for (const label of ['Число повторов', 'Начальная пауза, мс', 'Макс. пауза, мс']) {
      expect(input(label).disabled).toBe(true)
    }
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Сбросить' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables everything on a read-only document and notes an unavailable section', () => {
    mount(scopeSnapshot({ writable: false }))
    expect(input('Число повторов').disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Сбросить' }) as HTMLButtonElement).disabled).toBe(true)

    cleanup()
    mount(scopeSnapshot({ status: 'unavailable', value: undefined }))
    expect(screen.getByText('Секция настроек провайдера сейчас недоступна.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Применить' })).toBeNull()
  })

  it('resets through the injected face', async () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    await waitFor(() => { expect(b.reset).toHaveBeenCalledOnce() })
  })

  it('resets the draft when an external view advances the revision', async () => {
    const b = mount()
    edit('Число повторов', '9')
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(false)
    act(() => {
      b.rerender(scopeSnapshot({
        revision: 2,
        user: { retryPolicy: { mode: 'normal', maxRetries: 3, backoff: { initialDelayMs: 100, maxDelayMs: 2000 } } },
      }))
    })
    expect(input('Число повторов').value).toBe('5')
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('resolvedPolicy', () => {
  it('falls back to schema defaults per field and reports always mode', () => {
    expect(resolvedPolicy(RESOLVED_SECTION)).toEqual({
      alwaysMode: false, maxRetries: 5, initialDelayMs: 500, maxDelayMs: 10_000,
    })
    expect(resolvedPolicy({
      retryPolicy: { mode: 'always', backoff: { initialDelayMs: 1000 } },
    })).toEqual({ alwaysMode: true, maxRetries: 5, initialDelayMs: 1000, maxDelayMs: 10_000 })
    expect(resolvedPolicy({ retryPolicy: { mode: 'normal', maxRetries: 3 } })).toEqual({
      alwaysMode: false, maxRetries: 3, initialDelayMs: 500, maxDelayMs: 10_000,
    })
    expect(resolvedPolicy({})).toBeUndefined()
    expect(resolvedPolicy(undefined)).toBeUndefined()
  })
})

describe('parseRetryDraft', () => {
  it('accepts integers and rejects empty, negative, fractional, or inverted drafts', () => {
    expect(parseRetryDraft({ maxRetries: '0', initialDelayMs: '0', maxDelayMs: '1' })).toEqual({
      kind: 'values', values: { maxRetries: 0, initialDelayMs: 0, maxDelayMs: 1 },
    })
    for (const draft of [
      { maxRetries: '', initialDelayMs: '1', maxDelayMs: '2' },
      { maxRetries: '-1', initialDelayMs: '1', maxDelayMs: '2' },
      { maxRetries: '1.5', initialDelayMs: '1', maxDelayMs: '2' },
      { maxRetries: '1', initialDelayMs: '3', maxDelayMs: '2' },
    ]) {
      expect(parseRetryDraft(draft).kind).toBe('invalid')
    }
  })
})
