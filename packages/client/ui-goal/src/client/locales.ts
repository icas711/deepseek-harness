/** `goal` namespace dictionary. */

/** The goal namespace key union. */
export type GoalKey = keyof typeof ru

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'phase.active': 'Активная цель',
  'phase.paused': 'Приостановленная цель',
  'phase.blocked': 'Заблокированная цель',
  'objective.aria': 'Текст цели',
  'commandInput.aria': 'Поле ввода команды',
  'action.save': 'Сохранить цель',
  'action.cancel': 'Отменить редактирование',
  'action.pause': 'Приостановить цель',
  'action.resume': 'Возобновить цель',
  'action.edit': 'Редактировать цель',
  'action.clear': 'Очистить цель',
} satisfies Record<string, string>
