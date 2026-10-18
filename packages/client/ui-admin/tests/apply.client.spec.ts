/** Регистрация секции «Администрирование»: роль-гейт на клиенте, порядок, ярлык, перелогин. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-admin/client'
import { AdminSection } from '../src/client/AdminSection.tsx'
import { ru } from '../src/client/locales.ts'

/** Ответ admin.status, который подставляет фейковый транспорт. */
type StatusAnswer = { ok: true; value: { admin: boolean } }

async function bench(status: StatusAnswer | undefined, fail?: Error) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime()
  ctx.provide('locale', locale)
  const statusCall = vi.fn(async (): Promise<{ result: StatusAnswer }> => {
    if (fail !== undefined) throw fail
    return { result: status! }
  })
  ctx.provide('connection', {
    api: {
      admin: {
        status: statusCall,
        listUsers: async () => ({ result: { ok: true, value: { users: [] } } }),
      },
    },
  } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, statusCall }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

/** Микротики: проверка статуса и установка секции расходуют несколько очередей. */
async function settle(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve()
}

describe('ui-admin apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers the section for an admin and drops it when a re-login answers not-an-admin', async () => {
    const admin = await bench({ ok: true, value: { admin: true } })
    declare(admin.slots)
    await admin.ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(admin.slots.entries('settings.section')).toHaveLength(1) })
    const entry = admin.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(AdminSection)
    expect(entry.options).toMatchObject({ id: 'admin', order: 30 })
    expect(resolveSlotLabel(entry.options.label)).toBe('Администрирование')
    const injected = (entry.inject as unknown as () => import('../src/client/AdminSection.tsx').AdminSectionInjected)()
    expect(injected.t('title')).toBe(ru.title)
    expect(typeof injected.controller.load).toBe('function')
    expect(typeof injected.useSnapshot).toBe('function')

    // Перелогин обычным пользователем: секция снимается.
    admin.statusCall.mockImplementation(async () => ({ result: { ok: true, value: { admin: false } } }))
    admin.ctx.emit('connection/reset' as const)
    await vi.waitFor(() => { expect(admin.slots.entries('settings.section')).toHaveLength(0) })
  })

  it('registers nothing for a plain user, even when the declaration arrives later', async () => {
    const user = await bench({ ok: true, value: { admin: false } })
    await user.ctx.plugin({ inject: [...inject], apply }).await()
    declare(user.slots)
    await vi.waitFor(() => { expect(user.statusCall).toHaveBeenCalled() })
    await settle()
    expect(user.slots.entries('settings.section')).toHaveLength(0)
  })

  it('registers when the declaration appears after apply and the caller is an admin', async () => {
    const admin = await bench({ ok: true, value: { admin: true } })
    await admin.ctx.plugin({ inject: [...inject], apply }).await()
    declare(admin.slots)
    await vi.waitFor(() => { expect(admin.slots.entries('settings.section')[0]!.options.id).toBe('admin') })
  })

  it('treats a failed status probe as not-an-admin', async () => {
    const broken = await bench(undefined, new Error('offline'))
    await broken.ctx.plugin({ inject: [...inject], apply }).await()
    declare(broken.slots)
    await vi.waitFor(() => { expect(broken.statusCall).toHaveBeenCalled() })
    await settle()
    expect(broken.slots.entries('settings.section')).toHaveLength(0)
  })
})
