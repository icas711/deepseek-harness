/** `workflowRun` namespace dictionary. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'workflowRun'

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'run.title': '{name}',
  'run.members.one': '{count} участник',
  'run.members.other': '{count} участников',
  'run.empty': 'Нет запущенных участников',
  'phase.unassigned': 'Без фазы',
  'phase.empty': 'Пустое название фазы',
  'statusCount.running': 'Выполняется: {count}',
  'statusCount.completed': 'Завершено: {count}',
  'statusCount.failed': 'Сбой: {count}',
  'statusCount.cancelled': 'Отменено: {count}',
  'statusCount.interrupted': 'Прервано: {count}',
  'member.empty': 'Пустое имя участника',
  'member.open': 'Открыть {name}',
  'status.running': 'Выполняется',
  'status.completed': 'Завершено',
  'status.failed': 'Сбой',
  'status.cancelled': 'Отменено',
  'status.interrupted': 'Прервано',
} satisfies Record<string, string>

/** Union of this namespace's dictionary keys. */
export type WorkflowRunKey = keyof typeof ru
