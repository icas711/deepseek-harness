/** Locale namespace owned by Session export browser feedback. */
export const NS = 'session-log-download'

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'dialog.preparingTitle': 'Экспорт сессии',
  'dialog.preparingDescription': 'Подготавливается ZIP с этой сессией, её подсессиями и вложениями.',
  'dialog.successTitle': 'Загрузка сессии началась',
  'dialog.successDescription': 'Браузер скачивает ZIP-файл сессии.',
  'dialog.errorTitle': 'Не удалось экспортировать сессию',
  'dialog.close': 'Закрыть',
  'dialog.commandFailed': 'Не удалось запустить экспорт сессии.',
} satisfies Record<string, string>

/** Stable locale keys consumed by the shared modal. */
export type SessionLogDownloadKey = keyof typeof ru
