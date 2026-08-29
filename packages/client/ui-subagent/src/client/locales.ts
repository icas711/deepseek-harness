/** `subagent` namespace dictionary. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'subagent'

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'diagnostic.corrupt': 'повреждённая запись сессии',
  'diagnostic.unsupported': 'неподдерживаемая версия записи субагента',
  'diagnostic.unavailable': 'запись сессии временно недоступна',
  'duration.seconds': '{seconds} с',
  'duration.minutes': '{minutes} мин {seconds} с',
  'duration.hours': '{hours} ч {minutes} мин {seconds} с',
  'duration.days': '{days} д',
  'duration.daysHours': '{days} д {hours} ч',
  'duration.months': '~{months} мес',
  'duration.monthsDays': '~{months} мес {days} д',
  'duration.years': '~{years} г',
  'duration.yearsMonths': '~{years} г {months} мес',
  'duration.exactDays': '{days} д {hours} ч {minutes} мин {seconds} с',
  'duration.exactTitle': 'Общее активное время: {duration}',
  'loading.label': 'Загрузка субагентов…',
  'loading.aria': 'Загрузка субагентов',
  'load.error': 'Не удалось загрузить субагентов',
  'retry': 'Повторить',
  'mode.oneShot': 'однократный',
  'mode.continuable': 'продолжаемый',
  'activity.running': 'выполняется',
  'activity.inactive': 'не выполняется',
  'branch.collapse': 'Свернуть потомков {label}',
  'branch.expand': 'Развернуть потомков {label}',
  'count.total.one': '{count} субагент',
  'count.total.other': '{count} субагентов',
  'count.running.one': '{count} субагент выполняется',
  'count.running.other': '{count} субагентов выполняется',
  'tree.aria': 'Сессии субагентов',
  'readonly.oneShot.title': 'Запись однократного субагента',
  'readonly.title': 'Этот субагент пока доступен только для чтения',
  'readonly.oneShot.body': 'Однократные задачи не принимают последующие сообщения; полную запись выполнения можно посмотреть здесь.',
  'readonly.body': 'Родительская сессия не подключена; откройте её заново, чтобы продолжить отправку сообщений.',
} satisfies Record<string, string>

/** Key domain of the `subagent` namespace (the `ru` dictionary is the source of truth). */
export type SubagentKey = keyof typeof ru
