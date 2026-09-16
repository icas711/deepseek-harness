import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { sendFailureNotice } from '../src/client/input/hub.ts'
import { ru } from '../src/client/locales.ts'

const t = makeTranslate(ru)

describe('sendFailureNotice', () => {
  it('names the dead process when the connection is down', () => {
    expect(sendFailureNotice('reconnecting', t)).toBe(ru['send.processDown'])
  })

  it('stays generic when no health source or a live connection rejected the dispatch', () => {
    expect(sendFailureNotice(undefined, t)).toBe(ru['send.failed'])
    expect(sendFailureNotice('connected', t)).toBe(ru['send.failed'])
  })
})
