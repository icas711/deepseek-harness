/** `sidebar` namespace dictionary: shell controls (brand row, New Session, fold toggle). */

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof ru

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'session.new': 'Новая сессия',
  'session.new.label': 'Создать сессию',
  'toggle.open': 'Открыть боковую панель',
  'toggle.collapse': 'Свернуть боковую панель',
  'logout': 'Выйти',
} satisfies Record<string, string>
