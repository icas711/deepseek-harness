/**
 * Плагин «Задачи», браузерная половина. Страница своих задач супервизора
 * (shell.overlay) с кнопкой в панели (sidebar.footer.action), раздел
 * «Уведомления» в настройках (settings.section) и deep-link'и /tasks и
 * /session/<id>. Изоляция данных — на хосте: tasks.list отвечает только
 * задачи вызывающего, admin не видит чужих.
 *
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: словарный merge (ctx.locale) в этой программе.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: SlotMap-merge секций настроек ('settings.section').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: SlotMap-merge владельческих пропов кнопки панели ('sidebar.footer.action').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: SlotMap-merge overlay-слоя ('shell.overlay').
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { TasksPage } from './TasksPage.tsx'
import { TasksButton } from './TasksButton.tsx'
import { NotificationsSection } from './NotificationsSection.tsx'
import { NotificationsController } from './notifications-store.ts'
import { TasksController } from './store.ts'
import { TasksUiController } from './ui-store.ts'
import { ru, type TasksKey } from './locales.ts'

export type { TasksPageProps, TasksPageInjected } from './TasksPage.tsx'
export type { TasksButtonProps, TasksButtonInjected } from './TasksButton.tsx'
export type { NotificationsSectionProps, NotificationsSectionInjected } from './NotificationsSection.tsx'
export type { TasksKey } from './locales.ts'
export type { TasksState, TaskRow } from './store.ts'
export { RESUMABLE_STATUSES, relativeWhen, whenParams } from './store.ts'
export type { NotificationsState } from './notifications-store.ts'
export type { TasksUiState } from './ui-store.ts'
export { TasksUiController, INITIAL_UI_STATE } from './ui-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Копия страницы «Задачи» и раздела «Уведомления». */
    'tasks': TasksKey
  }
}

/** Пространство словаря этого плагина. */
const NS = 'tasks'

/** Порядок раздела «Уведомления» в навигации настроек: после «Администрирования» (30). */
const NOTIFICATIONS_SECTION_ORDER = 40

/** Требуемые сервисы (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'sessions']

/**
 * Deep-link маршруты: /tasks открывает страницу задач, /session/<id> —
 * сессию после загрузки списка. Адрес вычищается заменой, чтобы перезагрузка
 * не переоткрывала экран неожиданно.
 */
function readDeepLink(): { kind: 'tasks' } | { kind: 'session'; sessionId: string } | undefined {
  if (typeof location === 'undefined') return undefined
  if (location.pathname === '/tasks') return { kind: 'tasks' }
  const match = /^\/session\/([^/]+)$/.exec(location.pathname)
  if (match !== null) return { kind: 'session', sessionId: decodeURIComponent(match[1] ?? '') }
  return undefined
}

/**
 * Смонтировать поверхности: словарь, store видимости, overlay-страницу,
 * кнопку панели, раздел уведомлений и обработку deep-link'ов.
 * @param ctx - браузерный корневой контекст.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, ru), 'ui-tasks: словари')

  const connection = ctx.get('connection') as ConnectionHandle
  const api = connection.api
  const tasks = new TasksController(api)
  const notifications = new NotificationsController(api)
  // Видимость страницы — один контроллер на обе регистрации (и deep-link).
  const ui = new TasksUiController()
  // Видимость страницы — один контроллер на обе регистрации (и deep-link).

  const injected = () => ({
    controller: tasks,
    useTasks: bindSnapshotSelector(tasks.store),
    useUi: bindSnapshotSelector(ui.store),
    closeUi: () => { ui.close() },
    openSession: (sessionId: string) => { ctx.sessions.open(sessionId as SessionId) },
  })

  // Страница поверх рабочей области; слот объявлен ui-layout'ом.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'tasks-page',
    locale: NS,
    inject: injected,
  }, TasksPage))

  // Кнопка в панели; слот объявлен ui-sidebar'ом.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'tasks',
    order: 0,
    locale: NS,
    inject: () => ({ openTasks: () => { ui.open() } }),
  }, TasksButton))

  // Раздел «Уведомления» в настройках; слот объявлен ui-settings'ом.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'notifications',
    order: NOTIFICATIONS_SECTION_ORDER,
    label: () => ctx.locale.bind(NS)('notificationsNav'),
    locale: NS,
    inject: () => ({
      controller: notifications,
      useSnapshot: bindSnapshotSelector(notifications.store),
    }),
  }, NotificationsSection))

  ctx.effect(() => {
    // Deep-link: /tasks открывается сразу; /session/<id> ждёт готовности
    // списка сессий (объекты сессий рождаются на хосте), затем открывается.
    const link = readDeepLink()
    if (link !== undefined) history.replaceState({}, '', '/')
    if (link?.kind === 'tasks') ui.open()
    let pendingSession: string | undefined = link?.kind === 'session' ? link.sessionId : undefined
    const checkList = (): void => {
      const snapshot = ctx.sessions.list.getSnapshot()
      if (pendingSession === undefined || snapshot.phase !== 'ready') return
      if (snapshot.byId[pendingSession as SessionId] !== undefined) {
        ctx.sessions.open(pendingSession as SessionId)
        pendingSession = undefined
      }
    }
    // Готовый список проверяется сразу: событие может уже не прийти.
    const offLink = pendingSession === undefined
      ? undefined
      : ((): (() => void) => {
        checkList()
        return ctx.sessions.list.subscribe(checkList)
      })()
    // Обрыв связи: перечитать то, что уже открыто пользователю.
    const offReset = ctx.on('connection/reset', () => {
      if (tasks.store.getSnapshot().status !== 'idle') void tasks.load()
      if (notifications.store.getSnapshot().status !== 'idle') void notifications.load()
    })
    return () => {
      offLink?.()
      offReset()
    }
  }, 'ui-tasks: deep-links и перечитывание')
}
