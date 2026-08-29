/** `skill` namespace dictionary for the dedicated tool row. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'skill'

/** The skill namespace key union. */
export type SkillKey = keyof typeof ru

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'row.running': 'Загрузка скилла',
  'row.failed': 'Не удалось загрузить скилл',
  'row.stopped': 'Загрузка скилла остановлена',
  'row.instructions': 'Инструкции',
  'menu.userOnly': 'только пользовательские',
} satisfies Record<string, string>
