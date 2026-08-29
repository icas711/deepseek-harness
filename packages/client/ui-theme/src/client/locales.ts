/** `settings.theme` namespace dictionary (the Appearance row's copy). */

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof ru

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'appearance.title': 'Внешний вид',
  'appearance.light': 'Светлая',
  'appearance.dark': 'Тёмная',
  'appearance.system': 'Системная',
} satisfies Record<string, string>
