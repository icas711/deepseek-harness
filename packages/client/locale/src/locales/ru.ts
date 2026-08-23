import type { CommonKey } from './zh.ts'

/** ru base dictionary for the common namespace, checked complete against the zh key set. */
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
} satisfies Record<CommonKey, string>
