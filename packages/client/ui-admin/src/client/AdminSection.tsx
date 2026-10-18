/**
 * Страница «Администрирование» (слот settings.section; регистрирует её плагин
 * только для админов по admin.status, при этом хост проверяет роль на каждом
 * методе). Список пользователей с ролями и устройствами, создание
 * пользователя, сброс пароля с одноразовой выдачей нового, удаление и отзыв
 * устройств.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconCopyOutline16, IconPlusOutline16, IconRefreshOutline16, IconTrashOutline16,
  Input, Modal, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import { draftError, generatePassword, type AdminSectionState, type AdminUserRow } from './store.ts'
import type { AdminSectionController } from './store.ts'
import type { AdminKey } from './locales.ts'
import css from './AdminSection.module.css'

/** Внедряемые зависимости секции (слот inject). */
export interface AdminSectionInjected {
  /** Хранилище страницы: загрузка на монтировании и все мутации. */
  controller: AdminSectionController
  /** uSES-подписка на снимок хранилища. */
  useSnapshot: SnapshotSelectorHook<AdminSectionState>
  /** Словарь страницы. */
  t: (key: AdminKey, params?: Record<string, unknown>) => string
}

/** Пропы, раздаваемые гнездом слота (инжект распространяется плоско). */
export type AdminSectionProps = Partial<AdminSectionInjected>

/** Дата и время в русском коротком формате. */
function formatWhen(ms: number): string {
  return new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms))
}

/** Кнопка копирования с подписью. */
function CopyButton({ text, t }: { text: string; t: AdminSectionInjected['t'] }): ReactNode {
  return (
    <Tooltip label={t('copy')} side="top">
      <Button variant="outline" icon={<IconCopyOutline16 />} onClick={() => { void writeClipboard(text) }}>
        {t('copy')}
      </Button>
    </Tooltip>
  )
}

/** Строка создания пользователя. */
function CreateForm({ state, actions, t }: {
  state: AdminSectionState
  actions: Pick<AdminSectionController, 'setDraft' | 'create'>
  t: AdminSectionInjected['t']
}): ReactNode {
  const { draft } = state
  const blocker = draft.busy ? null : draftError(draft)
  return (
    <form
      className={css.create}
      onSubmit={(event) => {
        event.preventDefault()
        void actions.create()
      }}
    >
      <span className={css.createTitle}>{t('createHeading')}</span>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('createLogin')}</span>
        <Input
          value={draft.login}
          placeholder={t('createLoginPlaceholder')}
          spellCheck={false}
          onChange={(event) => { actions.setDraft({ login: event.target.value }) }}
        />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('createPassword')}</span>
        <span className={css.passwordRow}>
          <Input
            value={draft.password}
            type="password"
            autoComplete="new-password"
            onChange={(event) => { actions.setDraft({ password: event.target.value }) }}
          />
          <Button variant="outline" onClick={() => { actions.setDraft({ password: generatePassword() }) }}>
            {t('createGenerate')}
          </Button>
        </span>
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('createRole')}</span>
        <select
          className={css.select}
          value={draft.role}
          onChange={(event) => { actions.setDraft({ role: event.target.value as 'admin' | 'user' }) }}
        >
          <option value="user">{t('roleUser')}</option>
          <option value="admin">{t('roleAdmin')}</option>
        </select>
      </label>
      <div className={css.createFooter}>
        <Button variant="outline" icon={<IconPlusOutline16 />} disabled={draft.busy || blocker !== null} onClick={() => { void actions.create() }}>
          {draft.busy ? t('createCreating') : t('createSubmit')}
        </Button>
        {draft.error !== null && <span className={css.errorText}>{draft.error}</span>}
      </div>
    </form>
  )
}

/** Панель устройств одного пользователя. */
function DevicesPanel({ state, login, actions, t }: {
  state: AdminSectionState
  login: string
  actions: Pick<AdminSectionController, 'revoke' | 'revokeAll'>
  t: AdminSectionInjected['t']
}): ReactNode {
  const devices = state.devices[login]
  if (devices === undefined) return <div className={css.devices}>{t('loading')}</div>
  if (devices.length === 0) return <div className={css.devices}>{t('noDevices')}</div>
  return (
    <div className={css.devices}>
      <div className={css.devicesHead}>
        <span className={css.devicesTitle}>{t('devicesCount', { count: String(devices.length) })}</span>
        <Button variant="outline" onClick={() => { void actions.revokeAll(login) }}>{t('devicesRevokeAll')}</Button>
      </div>
      {devices.map(device => (
        <div key={device.sessionId} className={css.device}>
          <code className={css.deviceId}>{device.sessionId.slice(0, 8)}…</code>
          <span className={css.deviceMeta}>{t('deviceIssued')}: {formatWhen(device.issuedAt)}</span>
          <span className={css.deviceMeta}>{t('deviceSeen')}: {formatWhen(device.lastSeenAt)}</span>
          <Button variant="outline" onClick={() => { void actions.revoke(login, device.sessionId) }}>{t('deviceRevoke')}</Button>
        </div>
      ))}
    </div>
  )
}

/** Строка одного пользователя с действиями. */
function UserRow({ user, state, actions, t }: {
  user: AdminUserRow
  state: AdminSectionState
  actions: AdminSectionController
  t: AdminSectionInjected['t']
}): ReactNode {
  const busy = state.busyLogin === user.login
  return (
    <div className={css.rowBlock}>
      <div className={css.row}>
        <span className={css.login}>{user.login}</span>
        <span className={css.role} data-role={user.role}>{user.role === 'admin' ? t('roleAdmin') : t('roleUser')}</span>
        <span className={css.created}>{formatWhen(user.createdAt)}</span>
        <span className={css.rowActions}>
          <Button
            variant="ghost"
            aria-expanded={state.expanded === user.login}
            onClick={() => { void actions.expand(state.expanded === user.login ? null : user.login) }}
          >
            {t('devices')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => { actions.beginReset(user.login) }}>{t('resetPassword')}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => { void actions.toggleRole(user) }}>
            {user.role === 'admin' ? t('makeUser') : t('makeAdmin')}
          </Button>
          <Tooltip label={t('delete')} side="top">
            <Button variant="ghost" aria-label={t('delete')} disabled={busy} onClick={() => { actions.beginDelete(user.login) }}>
              <IconTrashOutline16 />
            </Button>
          </Tooltip>
        </span>
      </div>
      {state.expanded === user.login && <DevicesPanel state={state} login={user.login} actions={actions} t={t} />}
    </div>
  )
}

/**
 * Страница «Администрирование».
 * @param props - инжект-лицо секции.
 * @returns содержимое секции.
 */
export function AdminSection(props: AdminSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  const state = useSnapshot?.(snapshot => snapshot)
  if (controller === undefined || state === undefined || t === undefined) return null

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {state.error !== null && (
        <p className={css.error}>
          <span>{state.error}</span>
          <Button variant="outline" icon={<IconRefreshOutline16 />} onClick={() => { void controller.load() }}>{t('retry')}</Button>
        </p>
      )}
      <CreateForm
        state={state}
        t={t}
        actions={{ setDraft: (patch) => { controller.setDraft(patch) }, create: () => controller.create() }}
      />
      <div className={css.list}>
        <div className={css.head}>
          <span className={css.headCell}>{t('columnLogin')}</span>
          <span className={css.headCell}>{t('columnRole')}</span>
          <span className={css.headCell}>{t('columnCreated')}</span>
          <span className={css.headCell}>{t('columnActions')}</span>
        </div>
        {state.users.map(user => <UserRow key={user.login} user={user} state={state} actions={controller} t={t} />)}
      </div>

      <Modal
        open={state.resetFor !== null}
        onClose={() => { controller.cancelReset() }}
        title={t('resetTitle')}
        closeLabel={t('close')}
        description={t('resetIntro', { login: state.resetFor ?? '' })}
        footer={(
          <>
            <Button variant="outline" onClick={() => { controller.cancelReset() }}>{t('cancel')}</Button>
            <Button disabled={state.busyLogin !== null} onClick={() => { void controller.confirmReset() }}>
              {state.busyLogin !== null ? t('resetBusy') : t('resetGenerate')}
            </Button>
          </>
        )}
      >
        {null}
      </Modal>

      <Modal
        open={state.deleteFor !== null}
        onClose={() => { controller.cancelDelete() }}
        title={t('deleteTitle')}
        closeLabel={t('close')}
        description={t('deleteIntro', { login: state.deleteFor ?? '' })}
        footer={(
          <>
            <Button variant="outline" onClick={() => { controller.cancelDelete() }}>{t('cancel')}</Button>
            <Button disabled={state.busyLogin !== null} onClick={() => { void controller.confirmDelete() }}>{t('deleteConfirm')}</Button>
          </>
        )}
      >
        {null}
      </Modal>

      <Modal
        open={state.issued !== null}
        onClose={() => { controller.dismissIssued() }}
        title={t('issuedTitle', { login: state.issued?.login ?? '' })}
        closeLabel={t('close')}
        description={t('issuedIntro')}
        footer={<Button onClick={() => { controller.dismissIssued() }}>{t('issuedDone')}</Button>}
      >
        {state.issued === null ? null : (
          <div className={css.issued}>
            <code className={css.issuedPassword}>{state.issued.password}</code>
            <CopyButton text={state.issued.password} t={t} />
          </div>
        )}
      </Modal>
    </div>
  )
}
