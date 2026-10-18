/**
 * Раздел «Уведомления» (слот settings.section): статус привязки логина к
 * Telegram и выдача одноразового кода через notifier.beginBinding. Код
 * подтверждается в боте пользователя, поэтому раздел его только показывает.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, IconCopyOutline16, Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NotificationsController, NotificationsState } from './notifications-store.ts'
import type { TasksKey } from './locales.ts'
import css from './NotificationsSection.module.css'

/** Внедряемые зависимости раздела (слот inject). */
export interface NotificationsSectionInjected {
  /** Контроллер раздела: статус и код. */
  controller: NotificationsController
  /** uSES-подписка на снимок раздела. */
  useSnapshot: SnapshotSelectorHook<NotificationsState>
}

/** Полные пропы раздела: владельческий close + inject + словарь. */
export type NotificationsSectionProps = SettingsSectionOwnerProps & NotificationsSectionInjected & {
  /** Словарь раздела. */
  t: (key: TasksKey, params?: Record<string, unknown>) => string
}

/**
 * Отрисовать раздел «Уведомления».
 * @param props - контроллер, словарь и владелец слота.
 * @returns содержимое раздела.
 */
export function NotificationsSection(props: NotificationsSectionProps): ReactNode {
  const state = props.useSnapshot(s => s)
  // Статус читается при первом открытии раздела.
  useEffect(() => {
    if (state.status === 'idle') void props.controller.load()
  }, [props.controller, state.status])
  return (
    <div className={css.section}>
      <span className={clsx(css.title)}>{props.t('notificationsTitle')}</span>
      <p className={css.intro}>{props.t('notificationsIntro')}</p>
      {state.error !== null && <p className={css.error}>{state.error}</p>}
      <div className={css.statusRow}>
        <span className={css.badge}>
          <span className={clsx(css.badgeDot, state.bound && css.badgeBound)} aria-hidden />
          {state.status === 'loading' ? props.t('checking') : state.bound ? props.t('bound') : props.t('unbound')}
        </span>
        <Button
          variant="outline"
          disabled={state.busy}
          onClick={() => { void props.controller.beginBinding() }}
        >
          {state.busy ? props.t('binding') : props.t('bind')}
        </Button>
      </div>
      {state.code !== null && (
        <div className={css.codeCard}>
          <span className={css.codeTitle}>{props.t('bindTitle')}</span>
          <p className={css.codeHint}>{props.t('bindCodeHint')}</p>
          <div className={css.codeRow}>
            <span className={css.code}>{state.code}</span>
            <Tooltip label={props.t('copy')} side="top">
              <Button
                variant="outline"
                aria-label={props.t('copy')}
                onClick={() => { void writeClipboard(state.code ?? '') }}
              >
                <IconCopyOutline16 />
              </Button>
            </Tooltip>
            <Button variant="outline" onClick={() => { props.controller.dismissCode() }}>{props.t('bindDone')}</Button>
          </div>
          <span className={css.codeFooter}>{props.t('bindExpires')}</span>
        </div>
      )}
    </div>
  )
}
