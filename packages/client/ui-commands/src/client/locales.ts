/** `command` namespace dictionary (the popupSelect shell's copy). */

/** The command namespace key union. */
export type CommandKey = keyof typeof ru

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'search.placeholder': 'Поиск…',
  'search.aria': 'Фильтрация опций',
  'status.loading': 'Загрузка опций…',
  'status.applying': 'Применение…',
  'status.empty': 'Нет опций',
  'overlay.aria': '/{command} — опции',
  'listbox.aria': '/{command} — совпадения',
} satisfies Record<string, string>
