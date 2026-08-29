/**
 * The shipped common dictionary: cross-feature standard words. This is the
 * key-set source of truth for the `common` namespace — the product ships a
 * single locale, so the key union and the Russian text live together here.
 */

/** Common namespace dictionary (the only shipped locale). */
export const ru = {
  'ok': 'ОК',
  'cancel': 'Отмена',
  'close': 'Закрыть',
  'copy': 'Копировать',
  'copied': 'Скопировано',
  'retry': 'Повторить',
  'loading': 'Загрузка…',
  'load.failed': 'Не удалось загрузить',
  'submit': 'Отправить',
  'submitting': 'Отправка…',
  'next': 'Далее',
  'previous': 'Назад',
  'skip': 'Пропустить',
  'delete': 'Удалить',
  'edit': 'Редактировать',
  'save': 'Сохранить',
  'search': 'Поиск',
  'more': 'Ещё',
  'collapse': 'Свернуть',
  'expand': 'Развернуть',
  'back': 'Вернуться',
  'unknown': 'Неизвестно',
  'none': 'Нет',
  'truncated': 'Обрезано',
} satisfies Record<string, string>

/** The common vocabulary key union. */
export type CommonKey = keyof typeof ru
