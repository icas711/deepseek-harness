/**
 * Страница «Задачи» (слот shell.overlay): список СВОИХ задач супервизора —
 * статус цветным бейджем, станция, время, возобновление стоящих задач.
 * Отметки «завершённой» нет: исход работы фиксирует только хост. Закрытый
 * слой рендерит null, слот остаётся смонтированным.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, IconCloseOutline16, IconRefreshOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import { RESUMABLE_STATUSES, relativeWhen, whenParams } from './store.ts'
import type { TasksController, TasksState, TaskRow } from './store.ts'
import type { TasksUiState } from './ui-store.ts'
import type { TasksKey } from './locales.ts'
import css from './TasksPage.module.css'

/** Внедряемые зависимости страницы (слот inject). */
export interface TasksPageInjected {
  /** Контроллер данных: загрузка и возобновление. */
  controller: TasksController
  /** uSES-подписка на данные страницы. */
  useTasks: SnapshotSelectorHook<TasksState>
  /** uSES-подписка на видимость страницы. */
  useUi: SnapshotSelectorHook<TasksUiState>
  /** Закрыть страницу (действие владельца store'а видимости). */
  closeUi: () => void
  /** Открыть сессию задачи (навигация владельца — runtime sessions service). */
  openSession: (sessionId: string) => void
}

/** Полные пропы страницы: inject + словарь. */
export type TasksPageProps = TasksPageInjected & {
  /** Словарь страницы. */
  t: (key: TasksKey, params?: Record<string, unknown>) => string
}

/** Русская подпись статуса по ключу словаря. */
function statusLabel(status: TaskRow['status'], t: TasksPageProps['t']): string {
  switch (status) {
    case 'running': return t('statusRunning')
    case 'paused': return t('statusPaused')
    case 'interrupted': return t('statusInterrupted')
    case 'waiting-station': return t('statusWaitingStation')
    case 'completed': return t('statusCompleted')
    case 'failed': return t('statusFailed')
  }
}

/** Класс бейджа для статуса (CSS-модуль ключается PascalCase-суффиксом). */
function statusClass(status: TaskRow['status']): string {
  switch (status) {
    case 'running': return 'Running'
    case 'paused': return 'Paused'
    case 'interrupted': return 'Interrupted'
    case 'waiting-station': return 'WaitingStation'
    case 'completed': return 'Completed'
    case 'failed': return 'Failed'
  }
}

/** Одна строка списка: метка, бейдж статуса, станция, время, действия. */
function TaskItem(props: {
  task: TaskRow
  busy: boolean
  t: TasksPageProps['t']
  onResume: (taskId: string) => void
  onOpenSession: (sessionId: string) => void
}): ReactNode {
  const resumable = RESUMABLE_STATUSES.has(props.task.status)
  const when = relativeWhen(props.task.updatedAt)
  return (
    <div className={css.row}>
      <div className={css.rowMain}>
        <span className={css.taskTitle}>{props.task.title}</span>
        <span className={css.taskMeta}>
          <span>{props.t(when as TasksKey, whenParams(when, props.task.updatedAt))}</span>
          <button
            type="button"
            className={css.taskMeta}
            onClick={() => { props.onOpenSession(props.task.sessionId) }}
          >
            {props.t('openSession')}
          </button>
        </span>
      </div>
      <span className={clsx(css.badge, css['badge' + statusClass(props.task.status)])}>
        <span className={css.badgeDot} aria-hidden />
        {statusLabel(props.task.status, props.t)}
      </span>
      <span className={css.taskMeta}>
        {props.task.stationId === undefined ? props.t('stationServer') : props.task.stationId}
      </span>
      <div className={css.actions}>
        {resumable && (
          <Button
            variant="outline"
            disabled={props.busy}
            onClick={() => { props.onResume(props.task.taskId) }}
          >
            {props.busy ? props.t('resuming') : props.t('resume')}
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Отрисовать страницу задач; закрытое состояние — null.
 * @param props - внедрённые контроллеры, навигация и словарь.
 * @returns слой страницы или null.
 */
export function TasksPage(props: TasksPageProps) {
  const ui = props.useUi(s => s)
  const state = props.useTasks(s => s)
  // Первое открытие читает список; последующие — по кнопке «Обновить».
  useEffect(() => {
    if (ui.open && state.status === 'idle') void props.controller.load()
  }, [props.controller, ui.open, state.status])
  if (!ui.open) return null
  return (
    <div className={css.overlay}>
      <div className={css.panel} role="dialog" aria-modal="true" aria-label={props.t('title')}>
        <div className={css.header}>
          <div className={css.headerText}>
            <span className={css.title}>{props.t('title')}</span>
            <span className={css.intro}>{props.t('intro')}</span>
          </div>
          <Tooltip label={props.t('refresh')} side="bottom">
            <Button variant="outline" aria-label={props.t('refresh')} onClick={() => { void props.controller.load() }}>
              <IconRefreshOutline16 />
            </Button>
          </Tooltip>
          <Tooltip label={props.t('close')} side="bottom">
            <Button variant="outline" aria-label={props.t('close')} onClick={props.closeUi}>
              <IconCloseOutline16 />
            </Button>
          </Tooltip>
        </div>
        <div className={css.body}>
          {state.error !== null && <p className={css.error}>{state.error}</p>}
          {state.status === 'loading' && <div className={css.state}>{props.t('loading')}</div>}
          {state.status === 'error' && (
            <div className={css.state}>
              <div>{props.t('loadError')}</div>
              <Button variant="outline" onClick={() => { void props.controller.load() }}>{props.t('retry')}</Button>
            </div>
          )}
          {state.status === 'ready' && state.tasks.length === 0 && (
            <div className={css.state}>{props.t('empty')}</div>
          )}
          {state.tasks.length > 0 && (
            <div className={css.list}>
              {state.tasks.map(task => (
                <TaskItem
                  key={task.taskId}
                  task={task}
                  busy={state.busyTaskId === task.taskId}
                  t={props.t}
                  onResume={taskId => { void props.controller.resume(taskId) }}
                  onOpenSession={(sessionId) => {
                    props.closeUi()
                    props.openSession(sessionId)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
