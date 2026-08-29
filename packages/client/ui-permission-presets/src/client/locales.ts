/** `settings.permission` namespace dictionary (the Permission row's copy). */

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof ru

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'title': 'Права',
  'description': 'Режим прав по умолчанию для новых сессий',
  'loading': 'Загрузка',
  'unavailable': 'Недоступно',
  'confirm.title': 'Включить Full access?',
  'confirm.description': 'Full access позволяет новым сессиям сократить количество подтверждений и выполнять больше действий напрямую, включая чувствительные операции, изменение файлов и внешние команды. Включайте его, только если доверяете последующим задачам.',
  'confirm.acknowledge': 'Я понимаю риски и хочу продолжить',
  'confirm.cancel': 'Отмена',
  'confirm.enable': 'Включить Full access',
} satisfies Record<string, string>

/** Russian dictionary for the current-session popup gate (the only shipped locale). */
export const accessRu = {
  'confirm.title': 'Включить Full access?',
  'confirm.description': 'Full access сокращает количество подтверждений и позволяет агенту выполнять больше действий напрямую, включая чувствительные операции, изменение файлов и внешние команды. Включайте его, только если доверяете текущей задаче.',
  'confirm.acknowledge': 'Я понимаю риски и хочу продолжить',
  'confirm.cancel': 'Отмена',
  'confirm.enable': 'Включить Full access',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessRu
