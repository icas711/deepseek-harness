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
  | 'fleetLimits.usage'
  | 'fleetLimits.usageIntro'
  | 'fleetLimits.exampleParallelTitle'
  | 'fleetLimits.exampleParallelText'
  | 'fleetLimits.exampleSplitTitle'
  | 'fleetLimits.exampleSplitText'
  | 'fleetLimits.exampleCompareTitle'
  | 'fleetLimits.exampleCompareText'
  | 'fleetLimits.copy'

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
  'fleetLimits.usage': 'Как пользоваться',
  'fleetLimits.usageIntro': 'Попросите агента прямо в чате: каждая попытка — обычная сессия в своём worktree, видно в списке сессий.',
  'fleetLimits.exampleParallelTitle': 'Параллельные попытки',
  'fleetLimits.exampleParallelText': 'Запусти 3 параллельные попытки этой задачи в изолированных worktree. Когда попытки закончат, покажи их диффы (fleet_diff), выбери лучшую и слей её (fleet_merge), затем прибери за собой (fleet_cleanup).',
  'fleetLimits.exampleSplitTitle': 'Разбиение на независимые части',
  'fleetLimits.exampleSplitText': 'Разбей эту задачу на 3 независимые части и запусти по попытке на каждую в своём worktree (fleet_fanout). Диффы покажи через fleet_diff, победителя слей через fleet_merge.',
  'fleetLimits.exampleCompareTitle': 'Сравнение подходов',
  'fleetLimits.exampleCompareText': 'Предложи два разных подхода к этой задаче, запусти по попытке на каждый (fleet_fanout, 2 попытки), сравни через fleet_diff и слей победителя через fleet_merge.',
  'fleetLimits.copy': 'Скопировать',
} satisfies Record<FleetLimitsKey, string>
