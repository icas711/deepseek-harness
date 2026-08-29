/** Copy dictionary for the plugin inventory Settings section. */

/** Plugin inventory locale key union. */
export type PluginInventoryLocaleKey = keyof typeof ru

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  tab: 'Список плагинов',
  loading: 'Чтение плагинов…',
  error: 'Плагины временно недоступны.',
  retry: 'Повторить',
  search: 'Поиск плагинов',
  catalog: 'Список плагинов',
  empty: 'Нет доступных плагинов.',
  emptySearch: 'Нет подходящих плагинов.',
  enabledTag: 'Включён',
  disabledTag: 'Отключён',
  configuration: 'Конфигурация',
  cordis: 'Статус Cordis',
  unobserved: 'Не смонтирован',
  pending: 'Ожидает зависимостей',
  loadingPhase: 'Загрузка',
  active: 'Смонтирован',
  failed: 'Сбой монтирования',
  unloading: 'Выгрузка',
} satisfies Record<string, string>
