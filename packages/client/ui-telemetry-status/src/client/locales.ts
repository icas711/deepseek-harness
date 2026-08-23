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

export const en = {
  'telemetryStatus.label': 'Telemetry',
  'telemetryStatus.description': 'What this harness shares with its telemetry backend.',
  'telemetryStatus.unavailable': 'No telemetry backend is composed in this deployment.',
  'telemetryStatus.disabled': 'Disabled',
  'telemetryStatus.feedbackOnly': 'Feedback only',
  'telemetryStatus.full': 'Full',
  'telemetryStatus.disabledDesc': 'Nothing leaves this process.',
  'telemetryStatus.feedbackOnlyDesc': 'Exports a session only after you record feedback on it.',
  'telemetryStatus.fullDesc': 'Mirrors every session event to the collector.',
  'telemetryStatus.refresh': 'Refresh',
} satisfies Record<TelemetryStatusKey, string>

export const zh = {
  'telemetryStatus.label': '遥测',
  'telemetryStatus.description': '本 Harness 与遥测后端共享的内容。',
  'telemetryStatus.unavailable': '此部署未组合遥测后端。',
  'telemetryStatus.disabled': '已禁用',
  'telemetryStatus.feedbackOnly': '仅反馈',
  'telemetryStatus.full': '完整',
  'telemetryStatus.disabledDesc': '不会有任何数据离开本进程。',
  'telemetryStatus.feedbackOnlyDesc': '仅在你对会话记录反馈后导出该会话。',
  'telemetryStatus.fullDesc': '将每个会话事件镜像到收集器。',
  'telemetryStatus.refresh': '刷新',
} satisfies Record<TelemetryStatusKey, string>

/** Russian dictionary, checked complete against the zh key set. */
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
