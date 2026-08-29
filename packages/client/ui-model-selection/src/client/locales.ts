/**
 * `model` namespace dictionary.
 *
 * `trigger.selectAria` reads identically to `trigger.fallback` today and is
 * still a separate key: the visible fallback label and the accessible name of
 * an unset trigger are free to diverge per locale, and folding it into
 * `trigger.aria` would announce the degenerate "Select model, current Select
 * model".
 */

/** The model namespace key union. */
export type ModelKey = keyof typeof ru

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'command.description': 'Выбрать модель для этой беседы',
  'option.loadError': 'Не удалось загрузить каталог: {message}',
  'trigger.fallback': 'Выбор модели',
  'trigger.selectAria': 'Выбрать модель',
  'trigger.aria': 'Выбор модели, текущая {model}',
  'trigger.ariaEffort': 'Выбор модели, текущая {model}, уровень размышлений {effort}',
  'menu.aria': 'Модель и уровень размышлений',
  'menu.model': 'Модель',
  'menu.effort': 'Уровень размышлений',
  'effort.providerDefault': 'Default',
  'status.loading': 'Обновление списка моделей…',
  'error.action': 'Сбой операции с моделью: {message}',
  'action.reload': 'Обновить',
  'warning.groupLoad': '{name}: не удалось загрузить — {message}',
  'empty.models': 'Нет доступных моделей.',
  'blocked.composer': 'Эта модель недоступна — выберите другую, чтобы продолжить',
  'empty.efforts': 'Эта модель не предоставляет уровней размышлений.',
} satisfies Record<string, string>
