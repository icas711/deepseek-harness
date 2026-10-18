/**
 * Кнопка «Задачи» в панели (слот sidebar.footer.action): широкое состояние —
 * иконка с подписью, рейка — иконка с подсказкой. Открывает overlay-страницу.
 */

import clsx from 'clsx'
import { IconDataOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './TasksButton.module.css'

/** Внедряемые зависимости кнопки (слот inject). */
export interface TasksButtonInjected {
  /** Открыть страницу задач. */
  openTasks: () => void
}

/** Полные пропы кнопки: владельческое состояние ширины + inject + словарь. */
export type TasksButtonProps = SidebarFooterActionOwnerProps & TasksButtonInjected & PropsLocale<'tasks'>

/**
 * Отрисовать кнопку «Задачи».
 * @param props - ширина колонки, колбэк открытия и словарь.
 * @returns кнопку.
 */
export function TasksButton({ wide, openTasks, t }: TasksButtonProps) {
  return (
    <Tooltip label={t('nav')} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={clsx(css.button, !wide && css.rail)}
        aria-label={t('nav')}
        onClick={openTasks}
      >
        <IconDataOutline16 size={wide ? 14 : 18} />
        {wide && <span className={css.label}>{t('nav')}</span>}
      </button>
    </Tooltip>
  )
}
