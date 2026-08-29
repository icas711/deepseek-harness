/** Shell chrome and General-nav dictionary; feature rows own their copy. */

/** The settings namespace key union. */
export type SettingsKey = keyof typeof ru

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'trigger': 'Настройки',
  'title': 'Настройки',
  'close': 'Закрыть',
  'openDocument': 'Открыть файл конфигурации',
  'openDocument.error': 'Не удалось открыть файл конфигурации',
  'general.nav': 'Общие',
} satisfies Record<string, string>
