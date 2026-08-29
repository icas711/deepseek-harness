/** `deliverables` namespace dictionary. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'produced.label': 'Готовые файлы',
  'produced.moreOne': '+ 1 файл',
  'produced.more': '+ {count} файлов',
  'produced.open': 'Открыть {name}',
  'produced.showInFolder': 'Показать в папке',
} satisfies Record<string, string>

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof ru
