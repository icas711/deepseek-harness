import { describe, expect, it } from 'vitest'
import {
  bindingConfirmedText,
  BINDING_FAILED_TEXT,
  BINDING_HINT_TEXT,
  BINDING_REJECTED_TEXT,
  formatSessionLink,
  formatTaskText,
} from '../src/messages.ts'

describe('notification text format', () => {
  it('renders the paused headline with the action-required prefix', () => {
    expect(formatTaskText({ kind: 'paused', title: 'Перенести отчёты', sessionId: 's1' }, 'http://127.0.0.1:3080'))
      .toMatchInlineSnapshot(
        `
        "Требуется действие: задача приостановлена

        Задача: «Перенести отчёты»
        Открыть сессию: http://127.0.0.1:3080/session/s1"
      `,
      )
  })

  it('renders the interrupted headline', () => {
    expect(formatTaskText({ kind: 'interrupted', title: 'Пропавшая', sessionId: 's2' }, 'http://127.0.0.1:3080'))
      .toMatchInlineSnapshot(
        `
        "Требуется действие: задача прервана сбоем

        Задача: «Пропавшая»
        Открыть сессию: http://127.0.0.1:3080/session/s2"
      `,
      )
  })

  it('renders the completed headline', () => {
    expect(formatTaskText({ kind: 'completed', title: 'Готовая', sessionId: 's3' }, 'http://127.0.0.1:3080/'))
      .toMatchInlineSnapshot(
        `
        "Задача завершена

        Задача: «Готовая»
        Открыть сессию: http://127.0.0.1:3080/session/s3"
      `,
      )
  })

  it('renders the failed headline', () => {
    expect(formatTaskText({ kind: 'failed', title: 'Сломавшаяся', sessionId: 's4' }, 'http://127.0.0.1:3080'))
      .toMatchInlineSnapshot(
        `
        "Задача провалена

        Задача: «Сломавшаяся»
        Открыть сессию: http://127.0.0.1:3080/session/s4"
      `,
      )
  })

  it('drops the link line when no base URL is configured', () => {
    expect(formatTaskText({ kind: 'completed', title: 'Готовая', sessionId: 's3' }, undefined)).toMatchInlineSnapshot(
      `
      "Задача завершена

      Задача: «Готовая»"
    `,
    )
    expect(formatTaskText({ kind: 'completed', title: 'Готовая', sessionId: 's3' }, '   ')).toMatchInlineSnapshot(
      `
      "Задача завершена

      Задача: «Готовая»"
    `,
    )
  })

  it('trims trailing slashes from the base URL once', () => {
    expect(formatSessionLink('http://host:3080///', 's9')).toBe('http://host:3080/session/s9')
  })
})

describe('binding texts', () => {
  it('pins the confirmation, rejection, hint, and failure literals', () => {
    expect(bindingConfirmedText('anna')).toMatchInlineSnapshot(
      '"Аккаунт «anna» привязан: уведомления о задачах будут приходить в этот чат."',
    )
    expect(BINDING_REJECTED_TEXT).toMatchInlineSnapshot(
      '"Код не найдён или истёк. Запросите новый код сопряжения и отправьте /start КОД ещё раз."',
    )
    expect(BINDING_HINT_TEXT).toMatchInlineSnapshot(
      '"Отправьте /start КОД, где КОД — код сопряжения, полученный в DSH."',
    )
    expect(BINDING_FAILED_TEXT).toMatchInlineSnapshot('"Не удалось сохранить привязку. Попробуйте ещё раз."')
  })
})
