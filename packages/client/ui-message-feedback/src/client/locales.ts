/** `feedback` namespace dictionaries. */

/** The feedback namespace key union. */
export type MessageFeedbackKey = keyof typeof ru

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The per-message feedback controls' copy. */
    feedback: MessageFeedbackKey
  }
}

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'action.like': 'Хороший ответ',
  'action.likeActive': 'Снять оценку',
  'action.dislike': 'Проблемный ответ',
  'action.dislikeActive': 'Снять оценку',
  'note.open': 'Добавить комментарий',
  'note.placeholder': 'Что было хорошо, а что нет? (необязательно)',
  'note.save': 'Сохранить',
  'note.cancel': 'Отмена',
  'note.aria': 'Комментарий к оценке',
  'error.conflict': 'Эта оценка была изменена в другом месте; показано актуальное состояние',
  'error.load': 'Не удалось загрузить оценку',
  'error.generic': 'Не удалось сохранить оценку',
} satisfies Record<string, string>
