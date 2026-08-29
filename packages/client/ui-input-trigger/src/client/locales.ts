/**
 * `slash.menu` namespace dictionary: group titles keyed by source name
 * (the lookup chain returns the key itself, so an unknown source shows its
 * raw name), the pending row, and the listbox aria label.
 */

/** The slash.menu namespace key union. */
export type MenuKey = keyof typeof ru

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'command': 'Команды',
  'skill': 'Скиллы',
  'subagent': 'Субагенты',
  'loading': 'Загрузка…',
  'suggestions.aria': 'Подсказки триггеров',
} satisfies Record<string, string>
