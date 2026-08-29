/** `trajectory` namespace dictionary (view tab label + toolbar strings). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'trajectory'

/** The trajectory dictionary key set (the source of truth for both locales). */
export type TrajectoryKey =
  | 'view.trajectory'
  | 'toolbar.aria'
  | 'toolbar.duration'
  | 'toolbar.useActualDuration'
  | 'toolbar.useEqualWidth'
  | 'toolbar.actualTime'
  | 'toolbar.turns'
  | 'toolbar.expandTurns'
  | 'toolbar.collapseTurns'
  | 'toolbar.calls'
  | 'toolbar.expandCalls'
  | 'toolbar.collapseCalls'
  | 'toolbar.search'
  | 'toolbar.searchPlaceholder'
  | 'history.loadEarlier'
  | 'history.loadingEarlier'
  | 'history.loadEarlierHint'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The trajectory view tab label and toolbar strings. */
    'trajectory': TrajectoryKey
  }
}

/** Russian dictionary, checked complete against the key union. */
export const ru: Record<TrajectoryKey, string> = {
  'view.trajectory': 'Траектория',
  'toolbar.aria': 'Панель инструментов траектории',
  'toolbar.duration': 'Длительность',
  'toolbar.useActualDuration': 'Фактическая длительность',
  'toolbar.useEqualWidth': 'Одинаковая ширина операций',
  'toolbar.actualTime': 'Фактическое время',
  'toolbar.turns': 'Ходы',
  'toolbar.expandTurns': 'Развернуть ходы',
  'toolbar.collapseTurns': 'Свернуть ходы',
  'toolbar.calls': 'Вызовы',
  'toolbar.expandCalls': 'Развернуть вызовы',
  'toolbar.collapseCalls': 'Свернуть вызовы',
  'toolbar.search': 'Поиск по траектории',
  'toolbar.searchPlaceholder': 'Поиск',
  'history.loadEarlier': 'Загрузить предыдущую историю',
  'history.loadingEarlier': 'Загрузка предыдущей истории…',
  'history.loadEarlierHint': 'Нажмите, чтобы загрузить предыдущую историю',
}
