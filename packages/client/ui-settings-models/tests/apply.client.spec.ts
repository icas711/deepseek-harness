/** Models section registration: slot declaration injection, the read-time label thunk, and HMR recovery. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, refreshIfLoaded } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { ModelsSection } from '../src/client/ModelsSection.tsx'
import { OnboardingDialog } from '../src/client/OnboardingDialog.tsx'
import { RetrySettingsRow } from '../src/client/RetrySettingsRow.tsx'
import { WelcomeNotice } from '../src/client/WelcomeNotice.tsx'
import { ru } from '../src/client/locales.ts'

async function bench(
  isLoopback = true,
  scope: Record<string, unknown> = {},
  mutate?: (input: unknown) => Promise<unknown>,
) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime()
  ctx.provide('locale', locale)
  // The plugins inject `remote`; forwarded events reach them through the
  // same `$dispatch` handoff the connection sink makes.
  new TestRemote(ctx)
  // The apply path only captures the wire face; no call leaves this fake
  // until a section actually loads.
  ctx.provide('connection', { api: mutate === undefined ? {} : { settings: { mutate } }, isLoopback } as never)
  // The retry row binds the `llm-deepseek` namespace through the settings
  // seam; the fake vouches for one unavailable snapshot and no subscriptions.
  ctx.provide('settingsScope', {
    bind: () => ({
      getSnapshot: () => ({ status: 'unavailable', value: undefined, revision: undefined, ...scope }),
      subscribe: () => () => {},
    }),
  })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.section': { kind: 'list', scope: 'root' },
        'settings.onboarding': { kind: 'list', scope: 'root' },
        'settings.general.item': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

describe('ui-settings-models apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('registers the models nav entry for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = before.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(ModelsSection)
    expect(entry.options).toMatchObject({ id: 'models', order: 10 })
    // The nav label is a thunk; owners resolve it at read time.
    expect(resolveSlotLabel(entry.options.label)).toBe('Модели')
    const injected = (entry.inject as unknown as () => import('../src/client/ModelsSection.tsx').ModelsSectionInjected)()
    expect(injected.t('nav')).toBe('Модели')
    expect(injected.t('deleteTitle')).toBe('Удалить {provider}?')
    expect(typeof injected.controller.load).toBe('function')
    expect(typeof injected.useSnapshot).toBe('function')
    expect(injected.api).toBeDefined()
    // The General-section retry row: component, position, and the injected face.
    const retryRow = before.slots.entries('settings.general.item')[0]!
    expect(retryRow.component).toBe(RetrySettingsRow)
    expect(retryRow.options).toMatchObject({ id: 'llm-retries', order: 30 })
    const retryInjected = (
      retryRow.inject as unknown as () => import('../src/client/RetrySettingsRow.tsx').RetrySettingsRowInjected
    )()
    expect(typeof retryInjected.saveRetryPolicy).toBe('function')
    expect(typeof retryInjected.resetRetryPolicy).toBe('function')
    expect(typeof retryInjected.hooks.provider.getSnapshot).toBe('function')

    const onboarding = before.slots.entries('settings.onboarding')
    expect(onboarding).toHaveLength(2)
    expect(onboarding.find(entry => entry.options.id === 'welcome-notice')).toMatchObject({
      component: WelcomeNotice,
      options: { id: 'welcome-notice', order: -100 },
    })
    const zai = onboarding.find(entry => entry.options.id === 'zai')!
    expect(zai.component).toBe(OnboardingDialog)
    expect(zai.options).toMatchObject({ id: 'zai', order: 0 })
    const zaiInjected = (
      zai.inject as unknown as () => import('../src/client/OnboardingDialog.tsx').OnboardingInjected
    )()
    expect(zaiInjected.hooks.models).toBe(injected.controller.store)
    expect(zaiInjected.api).toBeDefined()

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('settings.section')).toHaveLength(0)
    expect(after.slots.entries('settings.onboarding')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('settings.section')[0]!.component).toBe(ModelsSection)
    expect(after.slots.entries('settings.onboarding')).toHaveLength(2)
    // The self-inflicted ledger notifications hit the duplicate guard.
    expect(after.slots.entries('settings.section')).toHaveLength(1)
  })

  it('saves and resets the retry policy through one revision-checked mutate', async () => {
    const mutate = vi.fn(async () => ({ result: { ok: true } as const }))
    const b = await bench(
      true,
      { status: 'ready', value: {}, user: undefined, revision: 4, writable: true, mode: 'host' },
      mutate,
    )
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const row = b.slots.entries('settings.general.item')[0]!
    const face = (row.inject as unknown as () => import('../src/client/RetrySettingsRow.tsx').RetrySettingsRowInjected)()
    expect(await face.saveRetryPolicy({ maxRetries: 7, initialDelayMs: 250, maxDelayMs: 8000 })).toBeUndefined()
    expect(mutate).toHaveBeenCalledWith({
      ns: 'llm-deepseek',
      ops: [{
        op: 'set',
        path: ['retryPolicy'],
        value: { mode: 'normal', maxRetries: 7, backoff: { initialDelayMs: 250, maxDelayMs: 8000 } },
      }],
      expectedRevision: 4,
    })
    expect(await face.resetRetryPolicy()).toBeUndefined()
    expect(mutate).toHaveBeenLastCalledWith({
      ns: 'llm-deepseek',
      ops: [{ op: 'unset', path: ['retryPolicy'] }],
      expectedRevision: 4,
    })
  })

  it('carries a user-layer backoff forward and omits the revision when the mirror has none', async () => {
    const mutate = vi.fn(async (_input: unknown) => ({ result: { ok: true } as const }))
    const b = await bench(
      true,
      {
        status: 'ready',
        value: {},
        user: { retryPolicy: { mode: 'normal', retryableCodes: ['SERVER'], backoff: { initialDelayMs: 900, jitterRatio: 0.2 } } },
        revision: undefined,
        writable: true,
        mode: 'host',
      },
      mutate,
    )
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const row = b.slots.entries('settings.general.item')[0]!
    const face = (row.inject as unknown as () => import('../src/client/RetrySettingsRow.tsx').RetrySettingsRowInjected)()
    expect(await face.saveRetryPolicy({ maxRetries: 4, initialDelayMs: 100, maxDelayMs: 2000 })).toBeUndefined()
    expect(mutate).toHaveBeenCalledWith({
      ns: 'llm-deepseek',
      ops: [{
        op: 'set',
        path: ['retryPolicy'],
        value: {
          mode: 'normal',
          retryableCodes: ['SERVER'],
          maxRetries: 4,
          backoff: { initialDelayMs: 100, jitterRatio: 0.2, maxDelayMs: 2000 },
        },
      }],
    })
    expect(mutate.mock.calls[0]![0]).not.toHaveProperty('expectedRevision')
  })

  it('carries user-layer siblings forward and reports conflicts and rejections', async () => {
    type MutateResult = { result: { ok: boolean; error?: { code: string; message: string } } }
    const mutate = vi.fn(async (_input: unknown): Promise<MutateResult> => ({ result: { ok: true } }))
      .mockResolvedValueOnce({ result: { ok: false, error: { code: 'settings-conflict', message: 'conflict' } } })
      .mockResolvedValueOnce({ result: { ok: false, error: { code: 'settings-rejected', message: 'нет такого поля' } } })
    const b = await bench(
      true,
      {
        status: 'ready',
        value: {},
        user: { retryPolicy: { mode: 'normal', maxRetries: 2, retryableCodes: ['SERVER'] } },
        revision: 2,
        writable: true,
        mode: 'host',
      },
      mutate,
    )
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const row = b.slots.entries('settings.general.item')[0]!
    const face = (row.inject as unknown as () => import('../src/client/RetrySettingsRow.tsx').RetrySettingsRowInjected)()
    const values = { maxRetries: 3, initialDelayMs: 100, maxDelayMs: 2000 }
    expect(await face.saveRetryPolicy(values)).toBe('Настройки изменились в другом месте, пока строка была открыта. Повторите попытку.')
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      ops: [{
        op: 'set',
        path: ['retryPolicy'],
        value: { mode: 'normal', maxRetries: 3, retryableCodes: ['SERVER'], backoff: { initialDelayMs: 100, maxDelayMs: 2000 } },
      }],
    })
    expect(await face.saveRetryPolicy(values)).toBe('нет такого поля')
  })

  it('re-registers after an HMR collapse re-declares the slot (stale disposer must not block)', async () => {
    const b = await bench()
    const redeclare = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section')).toHaveLength(1)
    // Declarer unload: the cascade removes our entry while our local
    // disposer variable goes stale.
    redeclare()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('settings.onboarding')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('settings.section')[0]!.component).toBe(ModelsSection)
    expect(b.slots.entries('settings.onboarding')).toHaveLength(2)
    // The recovered registration resolves its label through the locale seat.
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Модели')
  })

  it('registers the ru nav dictionary and disposes everything with the fiber', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.bind('settings.models')('nav')).toBe('Модели')
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('settings.onboarding')).toHaveLength(0)
    // The seat is free again — the dictionary disposer ran.
    expect(() => b.locale.register('settings.models', ru)).not.toThrow()
  })

  it('keeps remote-browser acknowledgement in process memory', async () => {
    const b = await bench(false)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'welcome-notice')!
    const injected = (
      entry.inject as unknown as () => import('../src/client/WelcomeNotice.tsx').WelcomeNoticeInjected
    )()

    await injected.controller.load()
    expect(injected.controller.store.getSnapshot()).toEqual({
      status: 'ready', acknowledged: false, error: null,
    })
  })
})

describe('pushed invalidations', () => {
  it('ignores invalidations before the page ever loaded', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // The fake wire face has no methods: a fetch attempt would throw.
    b.ctx.remote.$dispatch('settings/document-updated', ['llm-pi-ai', 1])
    b.ctx.remote.$dispatch('credentials/updated', ['OPENAI_API_KEY'])
    b.ctx.remote.$dispatch('llm/adapters-updated', [])
    b.ctx.emit('connection/reset')
  })

  it('refreshes a loaded page and skips an idle one', () => {
    const loads: number[] = []
    const controller = {
      store: { getSnapshot: () => ({ status: 'ready' }) },
      load: () => { loads.push(1); return Promise.resolve() },
    }
    refreshIfLoaded(controller as unknown as import('../src/client/store.ts').ModelsSettingsStore)
    expect(loads).toHaveLength(1)
    const idle = {
      store: { getSnapshot: () => ({ status: 'idle' }) },
      load: () => { loads.push(2); return Promise.resolve() },
    }
    refreshIfLoaded(idle as unknown as import('../src/client/store.ts').ModelsSettingsStore)
    expect(loads).toHaveLength(1)
  })

  it('routes pushed credential invalidation into the shared onboarding join', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'zai')!
    const injected = (
      entry.inject as unknown as
      () => import('../src/client/OnboardingDialog.tsx').OnboardingInjected
    )()
    injected.controller.store.update((state) => { state.status = 'ready' })
    const load = vi.spyOn(injected.controller, 'load').mockResolvedValue()
    b.ctx.remote.$dispatch('credentials/updated', ['ZAI_API_KEY'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('routes only the onboarding namespace invalidation into welcome state', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'welcome-notice')!
    const injected = (
      entry.inject as unknown as
      () => import('../src/client/WelcomeNotice.tsx').WelcomeNoticeInjected
    )()
    injected.hooks.welcome.update((state) => { state.status = 'ready' })
    const load = vi.spyOn(injected.controller, 'load').mockResolvedValue()

    b.ctx.remote.$dispatch('settings/document-updated', ['llm-deepseek', 1])
    expect(load).not.toHaveBeenCalled()
    b.ctx.remote.$dispatch('settings/document-updated', ['ui-onboarding', 2])
    expect(load).toHaveBeenCalledOnce()
    b.ctx.emit('connection/reset')
    expect(load).toHaveBeenCalledTimes(2)
  })
})
