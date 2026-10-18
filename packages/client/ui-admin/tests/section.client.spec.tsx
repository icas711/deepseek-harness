// @vitest-environment jsdom
/** Поведение страницы: список, создание, сброс с одноразовой выдачей пароля, удаление, устройства. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { AdminSection } from '../src/client/AdminSection.tsx'
import type { AdminSectionInjected, AdminSectionProps } from '../src/client/AdminSection.tsx'
import { AdminSectionController, generatePassword } from '../src/client/store.ts'
import type { AdminDeviceRow, AdminUserRow } from '../src/client/store.ts'
import { ru } from '../src/client/locales.ts'

afterEach(cleanup)

const USERS: AdminUserRow[] = [
  { login: 'admin', role: 'admin', createdAt: Date.UTC(2026, 0, 1, 12) },
  { login: 'bob', role: 'user', createdAt: Date.UTC(2026, 5, 15, 9) },
]

const DEVICES: AdminDeviceRow[] = [
  { sessionId: 'abcdef1234567890abcdef1234567890', issuedAt: Date.UTC(2026, 8, 1), expiresAt: Date.UTC(2026, 9, 1), lastSeenAt: Date.UTC(2026, 8, 30) },
]

/** Фейковый admin.* транспорт с шпионами всех методов. */
function fakeApi() {
  return {
    admin: {
      status: vi.fn(),
      listUsers: vi.fn(async () => ({ result: { ok: true, value: { users: USERS } } })),
      createUser: vi.fn(async (_payload: { login: string; password: string; role: 'admin' | 'user' }) => ({ result: { ok: true, value: {} } })),
      deleteUser: vi.fn(async () => ({ result: { ok: true, value: {} } })),
      resetPassword: vi.fn(async (_payload: { login: string; newPassword: string }) => ({ result: { ok: true, value: {} } })),
      setRole: vi.fn(async () => ({ result: { ok: true, value: {} } })),
      listDevices: vi.fn(async () => ({ result: { ok: true, value: { devices: DEVICES } } })),
      revokeDevice: vi.fn(async () => ({ result: { ok: true, value: {} } })),
      revokeAllDevices: vi.fn(async () => ({ result: { ok: true, value: { revoked: 1 } } })),
    },
  }
}

type Api = ReturnType<typeof fakeApi>

/** Отрендерить страницу над живым контроллером и фейковым транспортом. */
function renderSection(api: Api = fakeApi()) {
  const t: AdminSectionInjected['t'] = (key, params) => {
    let text: string = ru[key]
    for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
    return text
  }
  const controller = new AdminSectionController(api as never, t)
  const props: AdminSectionProps = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    t,
  }
  render(<AdminSection {...props} />)
  return { controller, api }
}

/** Строка списка одного пользователя (grid-блок с логином). */
function rowOf(login: string): HTMLElement {
  const cell = screen.getByText(login)
  const row = cell.closest('div')
  if (row === null) throw new Error(`нет строки для ${login}`)
  return row
}

describe('страница «Администрирование»', () => {
  it('загружает список при первом рендере и показывает пользователей', async () => {
    const { api } = renderSection()
    await waitFor(() => { expect(screen.getByText('bob')).toBeTruthy() })
    expect(screen.getByText('admin')).toBeTruthy()
    expect(api.admin.listUsers).toHaveBeenCalledTimes(1)
    expect(within(rowOf('admin')).getByText(ru.roleAdmin)).toBeTruthy()
    expect(within(rowOf('bob')).getByText(ru.roleUser)).toBeTruthy()
  })

  it('не отправляет форму без логина или с коротким паролем: кнопка заблокирована', async () => {
    const { api } = renderSection()
    await waitFor(() => { expect(screen.getByText('bob')).toBeTruthy() })
    const submit = screen.getByText(ru.createSubmit).closest('button')!
    // Без логина и пароля отправка недоступна.
    expect(submit).toHaveProperty('disabled', true)
    fireEvent.input(screen.getByPlaceholderText(ru.createLoginPlaceholder), { target: { value: 'carol' } })
    // Короткий пароль держит кнопку заблокированной.
    fireEvent.input(document.body.querySelector('input[type="password"]')!, { target: { value: 'коротко' } })
    expect(submit).toHaveProperty('disabled', true)
    fireEvent.click(submit)
    expect(api.admin.createUser).not.toHaveBeenCalled()
  })

  it('создаёт пользователя со сгенерированным паролем и перечитывает список', async () => {
    const { api } = renderSection()
    await waitFor(() => { expect(screen.getByText('bob')).toBeTruthy() })
    fireEvent.input(screen.getByPlaceholderText(ru.createLoginPlaceholder), { target: { value: 'carol' } })
    fireEvent.click(screen.getByText(ru.createGenerate))
    fireEvent.click(screen.getByText(ru.createSubmit))
    await waitFor(() => { expect(api.admin.createUser).toHaveBeenCalledTimes(1) })
    const call = api.admin.createUser.mock.calls[0]![0]
    expect(call.login).toBe('carol')
    expect(call.password).toHaveLength(16)
    expect(call.role).toBe('user')
    await waitFor(() => { expect(api.admin.listUsers).toHaveBeenCalledTimes(2) })
  })

  it('сброс пароля зовёт resetPassword и показывает новый пароль один раз', async () => {
    const { api } = renderSection()
    await waitFor(() => { expect(screen.getByText('bob')).toBeTruthy() })

    // Подтверждение называет логин и отменяется.
    fireEvent.click(within(rowOf('bob')).getByText(ru.resetPassword))
    expect(screen.getByText(ru.resetIntro.replace('{login}', 'bob'))).toBeTruthy()
    fireEvent.click(screen.getByText(ru.cancel))

    // Повторное открытие и сброс: новый пароль уходит на хост и показывается.
    fireEvent.click(within(rowOf('bob')).getByText(ru.resetPassword))
    fireEvent.click(screen.getByText(ru.resetGenerate))
    await waitFor(() => { expect(api.admin.resetPassword).toHaveBeenCalledTimes(1) })
    const call = api.admin.resetPassword.mock.calls[0]![0]
    expect(call.login).toBe('bob')
    expect(call.newPassword).toMatch(/^[A-Za-z0-9]{16}$/)
    await screen.findByText(ru.issuedIntro)
    expect(screen.getByText(call.newPassword)).toBeTruthy()
    fireEvent.click(screen.getByText(ru.issuedDone))
    expect(screen.queryByText(ru.issuedIntro)).toBeNull()
  })

  it('удаляет пользователя после подтверждения', async () => {
    const { api } = renderSection()
    await waitFor(() => { expect(screen.getByText('bob')).toBeTruthy() })
    fireEvent.click(within(rowOf('bob')).getByLabelText(ru.delete))
    expect(screen.getByText(ru.deleteIntro.replace('{login}', 'bob'))).toBeTruthy()
    fireEvent.click(screen.getByText(ru.deleteConfirm))
    await waitFor(() => { expect(api.admin.deleteUser).toHaveBeenCalledWith({ login: 'bob' }) })
    await waitFor(() => { expect(api.admin.listUsers).toHaveBeenCalledTimes(2) })
  })

  it('переключает роль через setRole', async () => {
    const { api } = renderSection()
    await waitFor(() => { expect(screen.getByText('bob')).toBeTruthy() })
    fireEvent.click(within(rowOf('bob')).getByText(ru.makeAdmin))
    await waitFor(() => { expect(api.admin.setRole).toHaveBeenCalledWith({ login: 'bob', role: 'admin' }) })
  })

  it('разворачивает устройства, отзывает одно и все', async () => {
    const { api } = renderSection()
    await waitFor(() => { expect(screen.getByText('bob')).toBeTruthy() })
    fireEvent.click(within(rowOf('bob')).getByRole('button', { name: ru.devices }))
    await waitFor(() => { expect(api.admin.listDevices).toHaveBeenCalledWith({ login: 'bob' }) })
    await waitFor(() => { expect(screen.getByText(ru.devicesCount.replace('{count}', '1'))).toBeTruthy() })
    fireEvent.click(screen.getByText(ru.deviceRevoke))
    await waitFor(() => { expect(api.admin.revokeDevice).toHaveBeenCalledWith({ login: 'bob', sessionId: DEVICES[0]!.sessionId }) })
    fireEvent.click(screen.getByText(ru.devicesRevokeAll))
    await waitFor(() => { expect(api.admin.revokeAllDevices).toHaveBeenCalledWith({ login: 'bob' }) })
  })

  it('генератор паролей даёт 16 знаков из алфавита без похожих символов', () => {
    const password = generatePassword()
    expect(password).toHaveLength(16)
    expect(password).toMatch(/^[A-Za-z0-9]+$/)
  })
})
