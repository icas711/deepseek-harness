// @vitest-environment jsdom
/** Регистрации ui-tasks: overlay-страница, кнопка панели, раздел уведомлений, deep-link'и. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-tasks/client'
import { TasksPage } from '../src/client/TasksPage.tsx'
import { TasksButton } from '../src/client/TasksButton.tsx'
import { NotificationsSection } from '../src/client/NotificationsSection.tsx'
import { ru } from '../src/client/locales.ts'

afterEach(cleanup)

/** Фейковый сервис сессий: список с готовой фазой и шпион открытия. */
function fakeSessions(withSession: boolean) {
  const open = vi.fn()
  return {
    open,
    list: createSnapshotStore({
      items: [],
      current: undefined,
      state: 'ready' as const,
      phase: 'ready' as const,
      error: null,
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: undefined,
      byId: withSession ? { s9: { id: 's9', title: 'Есть', blank: false, updatedAt: 1, running: false } } : {},
    }),
  }
}

async function bench(path: string, withSession = false) {
  history.replaceState({}, '', path)
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime())
  ctx.provide('connection', {
    api: {
      tasks: {
        list: vi.fn(async () => ({ result: { ok: true, value: { tasks: [] } } })),
        resume: vi.fn(async () => ({ result: { ok: true, value: {} } })),
      },
      notifier: {
        status: vi.fn(async () => ({ result: { ok: true, value: { bound: false } } })),
        beginBinding: vi.fn(async () => ({ result: { ok: true, value: { code: 'x' } } })),
      },
    },
  } as never)
  const sessions = fakeSessions(withSession)
  ctx.provide('sessions', sessions as never)
  // Объявления слотов, в которые регистрируется плагин.
  ctx.slots.register(
    {
      name: 'root',
      children: {
        'shell.overlay': { kind: 'list', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, sessions }
}

describe('ui-tasks apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'sessions'])
  })

  it('регистрирует все три поверхности: overlay, кнопку панели, раздел уведомлений', async () => {
    const { slots } = await bench('/')
    const overlay = slots.entries('shell.overlay')
    expect(overlay).toHaveLength(1)
    expect(overlay[0]!.component).toBe(TasksPage)
    const button = slots.entries('sidebar.footer.action')
    expect(button).toHaveLength(1)
    expect(button[0]!.component).toBe(TasksButton)
    const section = slots.entries('settings.section')
    expect(section.map(entry => entry.options.id)).toContain('notifications')
    const notifications = section.find(entry => entry.options.id === 'notifications')!
    expect(notifications.component).toBe(NotificationsSection)
    expect(notifications.options.order).toBe(40)
  })

  it('deep-link /tasks открывает страницу и вычищает адрес', async () => {
    const { slots } = await bench('/tasks')
    expect(location.pathname).toBe('/')
    // Поведенческая проверка открытия: страница, отрисованная над inject-лицом
    // регистрации, рендерит заголовок (открытое состояние).
    const overlay = slots.entries('shell.overlay')[0]!
    const injected = (overlay.inject as unknown as () => Record<string, unknown>)()
    cleanup()
    const pageProps = { ...(injected as object), t: (key: keyof typeof ru) => ru[key] }
    render(createElement(TasksPage, pageProps as never))
    expect(screen.getByText(ru.title)).toBeTruthy()
  })

  it('deep-link /session/<id> открывает сессию из готового списка', async () => {
    const { sessions } = await bench('/session/s9', true)
    await vi.waitFor(() => { expect(sessions.open).toHaveBeenCalledWith('s9') })
    expect(location.pathname).toBe('/')
  })

  it('метка раздела уведомлений берётся из словаря', async () => {
    const { slots } = await bench('/')
    const notifications = slots.entries('settings.section').find(entry => entry.options.id === 'notifications')!
    expect(notifications.options.label).toBeTypeOf('function')
    expect((notifications.options.label as () => string)()).toBe(ru.notificationsNav)
  })
})
