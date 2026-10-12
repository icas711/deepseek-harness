/**
 * Dictionary for the fleet limits row.
 */

export type FleetLimitsKey =
  | 'fleetLimits.label'
  | 'fleetLimits.description'
  | 'fleetLimits.maxMembers'
  | 'fleetLimits.maxFanoutDepth'
  | 'fleetLimits.apply'
  | 'fleetLimits.refresh'
  | 'fleetLimits.unavailable'
  | 'fleetLimits.invalid'

/** Russian dictionary, checked complete against the key union. */
export const ru = {
  'fleetLimits.label': 'Флот',
  'fleetLimits.description': 'Лимиты параллельных попыток: сколько сессий стартует один фанлаут и насколько глубоко разрешена вложенность. Применяется к следующим фанлаутам без перезапуска.',
  'fleetLimits.maxMembers': 'Попыток на фанлаут',
  'fleetLimits.maxFanoutDepth': 'Предел вложенности',
  'fleetLimits.apply': 'Применить',
  'fleetLimits.refresh': 'Обновить',
  'fleetLimits.unavailable': 'В этой композиции не смонтирована служба флота.',
  'fleetLimits.invalid': 'Введите целые числа.',
} satisfies Record<FleetLimitsKey, string>
