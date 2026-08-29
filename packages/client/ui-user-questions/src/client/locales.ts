/** `question` namespace dictionary. */

/** The question namespace key union. */
export type QuestionKey = keyof typeof ru

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'error.incomplete': 'Сначала завершите этот вопрос.',
  'error.unanswered': 'Выберите вариант или введите свой ответ.',
  'nav.prev': 'Предыдущий вопрос',
  'nav.next': 'Следующий вопрос',
  'nav.cancel': 'Отменить все вопросы',
  'option.recommended': 'Рекомендуется',
  'custom.placeholder': 'Введите свой ответ',
  'action.skip': 'Пропустить вопрос',
  'action.next': 'Далее',
  'plan.header': 'Согласование плана',
  'plan.approve': 'Одобрить',
  'plan.decline': 'Отклонить',
  'plan.discuss': 'Обсудить в чате',
} satisfies Record<string, string>
