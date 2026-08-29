/** Cordis dynamic-plugin UI dictionary. */

export const NS = 'cordis'

/** Translation keys owned by the Cordis UI namespace. */
export type CordisKey = keyof typeof ru

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dynamic Cordis UI copy. */
    cordis: CordisKey
  }
}

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'row.defineTitle': 'Регистрация плагина Cordis',
  'row.runTitle': 'Запуск плагина Cordis',
  'row.updateTitle': 'Обновление плагина Cordis',
  'row.stopTitle': 'Остановка плагина Cordis',
  'row.removeTitle': 'Удаление плагина Cordis',
  'purpose.missing': '(назначение не указано)',
  'status.idle': 'Готов',
  'status.awaitingApproval': 'Ожидает подтверждения',
  'status.failed': 'Сбой запуска',
  'status.clientPending': 'Client готов к активации',
  'status.running': 'Работает',
  'status.removed': 'Удалён',
  'status.superseded': 'Есть более новый запуск',
  'run.removed': 'Этот пакет больше не существует',
  'run.superseded': 'Ниже доступна более новая карточка запуска',
  'panel.hint': 'Управление запуском — в панели Cordis над настройками',
  'panel.plugins.aria': 'Плагины Cordis',
  'panel.approvals.aria': 'Подтверждения Cordis',
  'panel.trigger': 'Плагин Cordis',
  'panel.runningCount': 'Выполняется: {count}',
  'panel.title': 'Плагины Cordis',
  'panel.empty': 'Пока не определён ни один плагин',
  'panel.loading': 'Чтение…',
  'panel.readFailed': 'Не удалось прочитать список плагинов: {message}',
  'panel.group.current': 'Текущая сессия',
  'panel.group.others': 'Другие сессии',
  'panel.version': 'Версия',
  'panel.current': 'Текущий: {packageId}',
  'panel.next': 'Следующий: {packageId}',
  'action.approve': 'Разрешить',
  'action.approveOnce': 'Разрешить только эту версию',
  'action.approvePlugin': 'Разрешать будущие версии этого плагина',
  'action.decline': 'Отклонить',
  'action.run': 'Запустить',
  'action.stop': 'Остановить',
  'action.remove': 'Удалить',
  'action.retry': 'Повторить',
  'action.rollback': 'Откатить',
  'render.failedAbdicated': 'Сбой рендеринга в {slot}; восстановлен интерфейс по умолчанию:',
  'render.failedHeld': 'Сбой рендеринга в {slot}:',
  'a11y.defining': 'Определение плагина',
  'a11y.failed': 'Не удалось определить',
  'a11y.stopped': 'Определение прервано',
  'body.source': 'Исходный код плагина',
  'body.hostCode': 'Host',
  'body.clientCode': 'Client',
  'body.output': 'Результат',
  'body.copy': 'Копировать',
  'body.copied': 'Скопировано',
} satisfies Record<string, string>
