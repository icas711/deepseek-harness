/**
 * Контроллер страницы «Администрирование»: единственный источник факта — хост.
 * Каждая мутация пишется через admin.* и перечитывает список, а сброс пароля
 * генерирует новый пароль на клиенте и показывает его ровно один раз — хост
 * хранит только scrypt-хэш.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { AdminDeviceView, AdminUserView } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { AdminKey } from './locales.ts'

/** Строка списка пользователей. */
export type AdminUserRow = AdminUserView

/** Строка списка устройств одного пользователя. */
export type AdminDeviceRow = AdminDeviceView

/** Роль аккаунта (зеркало доменного контракта). */
export type AdminRole = 'admin' | 'user'

/** Черновик формы создания пользователя. */
export interface CreateDraft {
  login: string
  password: string
  role: AdminRole
  busy: boolean
  error: string | null
}

/** Одноразовый показ нового пароля после сброса. */
export interface IssuedPassword {
  login: string
  password: string
}

/** Снимок страницы. */
export interface AdminSectionState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Текст неудачи загрузки или последней операции. */
  error: string | null
  users: readonly AdminUserRow[]
  /** Устройства по логину; загружаются при разворачивании строки. */
  devices: Readonly<Record<string, readonly AdminDeviceRow[]>>
  /** Развёрнутая строка (логин) или null. */
  expanded: string | null
  draft: CreateDraft
  /** Логин с открытым подтверждением сброса пароля. */
  resetFor: string | null
  /** Одноразовая выдача нового пароля. */
  issued: IssuedPassword | null
  /** Логин с открытым подтверждением удаления. */
  deleteFor: string | null
  /** Логин, для которого прямо сейчас идёт мутация. */
  busyLogin: string | null
}

/** Начальный снимок. */
export const INITIAL_STATE: AdminSectionState = {
  status: 'idle',
  error: null,
  users: [],
  devices: {},
  expanded: null,
  draft: { login: '', password: '', role: 'user', busy: false, error: null },
  resetFor: null,
  issued: null,
  deleteFor: null,
  busyLogin: null,
}

/** Алфавит генератора паролей: без похожих символов и без неоднозначных знаков. */
const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Длина сгенерированного пароля: 16 знаков по 6 бит — запас поверх минимума хоста. */
const GENERATED_PASSWORD_LENGTH = 16

/**
 * Сгенерировать пароль из криптографического источника браузера.
 * @returns новый пароль, нигде не сохраняемый клиентом.
 */
export function generatePassword(): string {
  const bytes = new Uint32Array(GENERATED_PASSWORD_LENGTH)
  crypto.getRandomValues(bytes)
  let password = ''
  for (const byte of bytes) password += PASSWORD_ALPHABET.charAt(byte % PASSWORD_ALPHABET.length)
  return password
}

/** Сообщение об отказе вызова: текст хоста, а не внутреннее представление. */
export function messageOf(result: { ok: true } | { ok: false; error: { message: string } }): string | null {
  return result.ok ? null : result.error.message
}

/** Ключи локальных запретов формы создания. */
export type DraftBlocker = 'loginInvalid' | 'passwordShort'

/** Черновая проверка формы создания: только локальные запреты, хост перепроверяет. */
export function draftError(draft: CreateDraft): DraftBlocker | null {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(draft.login)) return 'loginInvalid'
  if (draft.password.length < 8) return 'passwordShort'
  return null
}

/**
 * Контроллер страницы: читает список, исполняет мутации и держит диалоги.
 * Хост остаётся единственным источником факта — после каждой мутации список
 * перечитывается.
 */
export class AdminSectionController {
  /** Снимок страницы (источник хука рендера). */
  readonly store: SnapshotStore<AdminSectionState> = createSnapshotStore(INITIAL_STATE)

  /**
   * @param api - транспорт admin.* домена.
   * @param t - словарь страницы (для текстов ошибок локальных запретов).
   */
  constructor(private readonly api: IApiClient, private readonly t: (key: AdminKey) => string) {}

  /** Прочитать список пользователей; устройства развёрнутой строки перечитываются вместе с ним. */
  async load(): Promise<void> {
    const snapshot = this.store.getSnapshot()
    this.store.update((state) => {
      state.status = snapshot.status === 'idle' ? 'loading' : state.status
      state.error = null
    })
    const response = await this.api.admin.listUsers({})
    if (!response.result.ok) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(response.result)
      })
      return
    }
    const users = response.result.value.users
    const expanded = this.store.getSnapshot().expanded
    const devices = { ...this.store.getSnapshot().devices }
    if (expanded !== null && users.some(user => user.login === expanded)) {
      const read = await this.api.admin.listDevices({ login: expanded })
      if (read.result.ok) devices[expanded] = read.result.value.devices
    }
    this.store.update((state) => {
      state.status = 'ready'
      state.users = users
      state.devices = devices
    })
  }

  /** Развернуть/свернуть устройства пользователя. */
  async expand(login: string | null): Promise<void> {
    this.store.update((state) => {
      state.expanded = login
    })
    if (login === null) return
    const read = await this.api.admin.listDevices({ login })
    this.store.update((state) => {
      if (state.expanded !== login) return
      if (!read.result.ok) {
        state.error = messageOf(read.result)
        return
      }
      state.devices = { ...state.devices, [login]: read.result.value.devices }
    })
  }

  /** Правка черновика создания. */
  setDraft(patch: Partial<Pick<CreateDraft, 'login' | 'password' | 'role'>>): void {
    this.store.update((state) => {
      state.draft = { ...state.draft, ...patch, error: null }
    })
  }

  /** Создать пользователя; список перечитывается после успеха. */
  async create(): Promise<void> {
    const { draft } = this.store.getSnapshot()
    const blocker = draftError(draft)
    if (blocker !== null) {
      this.store.update((state) => {
        state.draft = { ...state.draft, error: this.t(blocker) }
      })
      return
    }
    this.store.update((state) => {
      state.draft = { ...state.draft, busy: true, error: null }
    })
    const response = await this.api.admin.createUser({ login: draft.login, password: draft.password, role: draft.role })
    if (!response.result.ok) {
      this.store.update((state) => {
        state.draft = { ...state.draft, busy: false, error: messageOf(response.result) }
      })
      return
    }
    this.store.update((state) => {
      state.draft = { login: '', password: '', role: 'user', busy: false, error: null }
    })
    await this.load()
  }

  /** Открыть подтверждение сброса пароля. */
  beginReset(login: string): void {
    this.store.update((state) => {
      state.resetFor = login
    })
  }

  /** Закрыть подтверждение сброса пароля. */
  cancelReset(): void {
    this.store.update((state) => {
      state.resetFor = null
    })
  }

  /**
   * Сбросить пароль: клиент генерирует новый, хост хранит только хэш, а
   * выдача показывается один раз.
   * @returns сгенерированный пароль для диалога выдачи.
   */
  async confirmReset(): Promise<string | undefined> {
    const login = this.store.getSnapshot().resetFor
    if (login === null) return undefined
    const password = generatePassword()
    this.store.update((state) => {
      state.busyLogin = login
    })
    const response = await this.api.admin.resetPassword({ login, newPassword: password })
    this.store.update((state) => {
      state.busyLogin = null
      if (!response.result.ok) {
        state.error = messageOf(response.result)
        return
      }
      state.resetFor = null
      state.issued = { login, password }
      state.devices = {}
      if (state.expanded === login) state.expanded = null
    })
    return password
  }

  /** Закрыть одноразовую выдачу пароля. */
  dismissIssued(): void {
    this.store.update((state) => {
      state.issued = null
    })
  }

  /** Открыть подтверждение удаления. */
  beginDelete(login: string): void {
    this.store.update((state) => {
      state.deleteFor = login
    })
  }

  /** Закрыть подтверждение удаления. */
  cancelDelete(): void {
    this.store.update((state) => {
      state.deleteFor = null
    })
  }

  /** Удалить пользователя и перечитать список. */
  async confirmDelete(): Promise<void> {
    const login = this.store.getSnapshot().deleteFor
    if (login === null) return
    this.store.update((state) => {
      state.busyLogin = login
    })
    const response = await this.api.admin.deleteUser({ login })
    this.store.update((state) => {
      state.busyLogin = null
      if (!response.result.ok) {
        state.error = messageOf(response.result)
        state.deleteFor = null
        return
      }
      state.deleteFor = null
    })
    await this.load()
  }

  /** Переключить роль пользователя; хост охраняет последнего админа. */
  async toggleRole(user: AdminUserRow): Promise<void> {
    const role: AdminRole = user.role === 'admin' ? 'user' : 'admin'
    this.store.update((state) => {
      state.busyLogin = user.login
    })
    const response = await this.api.admin.setRole({ login: user.login, role })
    this.store.update((state) => {
      state.busyLogin = null
      if (!response.result.ok) state.error = messageOf(response.result)
    })
    await this.load()
  }

  /** Отозвать одно устройство пользователя. */
  async revoke(login: string, sessionId: string): Promise<void> {
    const response = await this.api.admin.revokeDevice({ login, sessionId })
    if (!response.result.ok) {
      this.store.update((state) => {
        state.error = messageOf(response.result)
      })
      return
    }
    await this.expand(login)
  }

  /** Отозвать все устройства пользователя. */
  async revokeAll(login: string): Promise<void> {
    const response = await this.api.admin.revokeAllDevices({ login })
    this.store.update((state) => {
      if (!response.result.ok) {
        state.error = messageOf(response.result)
        return
      }
      state.devices = { ...state.devices, [login]: [] }
    })
  }
}
