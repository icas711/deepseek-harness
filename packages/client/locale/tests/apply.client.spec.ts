/** locale apply wiring: service provision, common-dictionary seeding, and
 * LocaleFace installation. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, COMMON_NS, inject, LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'

describe('locale apply', () => {
  it('declares the slot service', () => {
    expect(inject).toEqual(['slots'])
  })

  it('provides ctx.locale seeded with the common namespace and installs the LocaleFace', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const locale = ctx.get('locale') as LocaleRuntime
    expect(locale).toBeInstanceOf(LocaleRuntime)
    // The shipped common dictionary occupies the namespace seat; a second
    // registration for it fails loud (one owner per namespace).
    expect(() => locale.register(COMMON_NS, { retry: 'x' })).toThrow('already has a dictionary')
    expect(locale.bind(COMMON_NS)('retry')).toBe('Повторить')
    // A miss inside the common namespace echoes the key (untyped bind arm).
    expect(locale.bind(COMMON_NS as string)('missing.key')).toBe('missing.key')
  })
})
