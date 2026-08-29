/** Web-localized copy for the four shipped presets and file copy for every other row. */

import { describe, expect, it } from 'vitest'
import { presetDisplayText, ru } from '../src/client/locales.ts'

const translate = (bundle: typeof ru) => (key: keyof typeof ru): string => bundle[key]

describe('preset display copy', () => {
  it.each([
    ['standard', 'presetStandardName', 'presetStandardDescription'],
    ['code', 'presetCodeName', 'presetCodeDescription'],
    ['minimal', 'presetMinimalName', 'presetMinimalDescription'],
    ['cordis', 'presetCordisName', 'presetCordisDescription'],
  ] as const)('localizes the shipped %s preset in the shipped Russian copy', (id, nameKey, descriptionKey) => {
    const preset = { id, trust: 'system' as const, name: 'file name', description: 'file description' }

    expect(presetDisplayText(preset, translate(ru)))
      .toEqual({ name: ru[nameKey], description: ru[descriptionKey] })
  })

  it('keeps file metadata for user and unknown system presets', () => {
    const fileCopy = { name: '我的标准', description: '团队自己的 preset。' }

    expect(presetDisplayText({ id: 'standard', trust: 'user', ...fileCopy }, translate(ru)))
      .toEqual(fileCopy)
    expect(presetDisplayText({ id: 'deployment-extra', trust: 'system', ...fileCopy }, translate(ru)))
      .toEqual(fileCopy)
    expect(presetDisplayText({ id: 'bare', trust: 'user' }, translate(ru)))
      .toEqual({ name: 'bare' })
  })
})
