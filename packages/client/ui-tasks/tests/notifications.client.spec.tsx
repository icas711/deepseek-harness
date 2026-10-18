// @vitest-environment jsdom
/** Раздел «Уведомления»: статус привязки, выдача и скрытие кода. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { NotificationsSection } from '../src/client/NotificationsSection.tsx'
import type { NotificationsSectionProps } from '../src/client/NotificationsSection.tsx'
import { NotificationsController } from '../src/client/notifications-store.ts'
import { ru } from '../src/client/locales.ts'

afterEach(cleanup)

function fakeApi() {
  return {
    notifier: {
      status: vi.fn(async (): Promise<unknown> => ({ result: { ok: true, value: { bound: false } } })),
      beginBinding: vi.fn(async (): Promise<unknown> => ({ result: { ok: true, value: { code: 'a1b2c3d4' } } })),
    },
  }
}

function renderSection(api = fakeApi(), ownerClose = vi.fn()) {
  const controller = new NotificationsController(api as never)
  const props: NotificationsSectionProps = {
    close: ownerClose,
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    t: key => ru[key],
  }
  render(<NotificationsSection {...props} />)
  return { controller, api, ownerClose }
}

describe('раздел «Уведомления»', () => {
  it('читает статус при открытии и показывает «Не привязано»', async () => {
    const { api } = renderSection()
    await waitFor(() => { expect(api.notifier.status).toHaveBeenCalledWith({}) })
    await waitFor(() => { expect(screen.getByText(ru.unbound)).toBeTruthy() })
  })

  it('«Привязать Telegram» показывает код и адрес-подсказку команды', async () => {
    const { api } = renderSection()
    await waitFor(() => { expect(screen.getByText(ru.unbound)).toBeTruthy() })
    fireEvent.click(screen.getByText(ru.bind))
    await waitFor(() => { expect(api.notifier.beginBinding).toHaveBeenCalledWith({}) })
    await waitFor(() => { expect(screen.getByText('a1b2c3d4')).toBeTruthy() })
    expect(screen.getByText(ru.bindCodeHint)).toBeTruthy()
  })

  it('«Готово» скрывает код', async () => {
    renderSection()
    await waitFor(() => { expect(screen.getByText(ru.unbound)).toBeTruthy() })
    fireEvent.click(screen.getByText(ru.bind))
    await waitFor(() => { expect(screen.getByText('a1b2c3d4')).toBeTruthy() })
    fireEvent.click(screen.getByText(ru.bindDone))
    expect(screen.queryByText('a1b2c3d4')).toBeNull()
  })

  it('отказ хоста показывается текстом хоста', async () => {
    const api = fakeApi()
    api.notifier.status.mockResolvedValue({ result: { ok: false, error: { code: 'notifier-unavailable', message: 'уведомления недоступны', details: {} } } })
    renderSection(api)
    await waitFor(() => { expect(screen.getByText('уведомления недоступны')).toBeTruthy() })
  })
})
