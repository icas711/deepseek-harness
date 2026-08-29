/**
 * Dictionary for the telemetry status row.
 */

export type TelemetryStatusKey =
  | 'telemetryStatus.label'
  | 'telemetryStatus.description'
  | 'telemetryStatus.unavailable'
  | 'telemetryStatus.disabled'
  | 'telemetryStatus.feedbackOnly'
  | 'telemetryStatus.full'
  | 'telemetryStatus.disabledDesc'
  | 'telemetryStatus.feedbackOnlyDesc'
  | 'telemetryStatus.fullDesc'
  | 'telemetryStatus.refresh'

/** Russian dictionary, checked complete against the key union. */
export const ru = {
  'telemetryStatus.label': 'Телеметрия',
  'telemetryStatus.description': 'Что этот Harness передаёт своему телеметрическому бэкенду.',
  'telemetryStatus.unavailable': 'В этом развертывании не скомпонован телеметрический бэкенд.',
  'telemetryStatus.disabled': 'Отключена',
  'telemetryStatus.feedbackOnly': 'Только отзывы',
  'telemetryStatus.full': 'Полная',
  'telemetryStatus.disabledDesc': 'Из этого процесса ничего не уходит.',
  'telemetryStatus.feedbackOnlyDesc': 'Экспортирует сессию только после того, как вы оставите по ней отзыв.',
  'telemetryStatus.fullDesc': 'Передаёт каждое событие сессии в коллектор.',
  'telemetryStatus.refresh': 'Обновить',
} satisfies Record<TelemetryStatusKey, string>
