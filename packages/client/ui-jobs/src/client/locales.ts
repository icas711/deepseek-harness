/** `job` namespace dictionary. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'job'

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'count.live.one': '{count} фоновая задача выполняется',
  'count.live.other': '{count} фоновых задач выполняется',
  'count.idle.one': '{count} фоновая задача',
  'count.idle.other': '{count} фоновых задач',
  'list.aria': 'Фоновые задачи',
  'status.running': 'выполняется',
  'status.stopping': 'останавливается',
  'status.completed': 'завершено',
  'status.killed': 'отменено',
  'status.failed': 'сбой',
  'duration.seconds': '{seconds} с',
  'duration.minutes': '{minutes} мин {seconds} с',
  'duration.hours': '{hours} ч {minutes} мин',
  'duration.title.live': 'Выполняется уже {duration}',
  'duration.title.done': 'Заняло {duration}',
} satisfies Record<string, string>

/** Key domain of the `job` namespace (the `ru` dictionary is the source of truth). */
export type JobKey = keyof typeof ru
