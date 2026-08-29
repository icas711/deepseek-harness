// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'

const make = (): { ctx: Context; svc: LocaleRuntime } => {
  const ctx = new Context()
  return { ctx, svc: new LocaleRuntime() }
}

describe('LocaleRuntime', () => {
  it('translates through the namespace -> common -> key chain', () => {
    const { svc } = make()
    svc.register('common', { retry: 'Повторить' })
    svc.register('ns', { own: 'Своё' })
    const t = svc.bind('ns')
    expect(t('retry')).toBe('Повторить')
    expect(t('own')).toBe('Своё')
    expect(t('missing.key')).toBe('missing.key')
    // common itself must not recurse: a miss inside common echoes the key.
    // (Wide-string ns hits the untyped bind overload — the typed one rejects
    // unknown keys at compile time, which is the point of the typed registry contract.)
    expect(svc.bind('common' as string)('nope')).toBe('nope')
  })

  it('interpolates {name} params and leaves unknown placeholders intact', () => {
    const { svc } = make()
    svc.register('ns', { greet: 'Привет, {name}! № {n}', partial: '{known} и {unknown}' })
    const t = svc.bind('ns')
    expect(t('greet', { name: 'мир', n: 2 })).toBe('Привет, мир! № 2')
    expect(t('partial', { known: 'A' })).toBe('A и {unknown}')
  })

  it('bind returns a stable per-namespace function identity', () => {
    const { svc } = make()
    expect(svc.bind('a')).toBe(svc.bind('a'))
    expect(svc.bind('a')).not.toBe(svc.bind('b'))
  })

  it('rejects a duplicate namespace and the disposer only removes its own dict', () => {
    const { svc } = make()
    const dispose = svc.register('ns', { k: 'v1' })
    expect(() => svc.register('ns', { k: 'v2' })).toThrow('already has a dictionary')
    dispose()
    const t = svc.bind('ns')
    expect(t('k')).toBe('k')
    svc.register('ns', { k: 'v2' })
    expect(t('k')).toBe('v2')
  })

  it('serves the LocaleFace: revision moves on registration, subscribers fire, unsubscribe stops them', () => {
    const { svc } = make()
    const seen: number[] = []
    const off = svc.subscribe(() => { seen.push(svc.getSnapshot().revision) })
    const r0 = svc.getSnapshot().revision
    svc.register('ns', { k: 'v' })
    expect(svc.getSnapshot().revision).toBe(r0 + 1)
    expect(seen).toEqual([r0 + 1])
    off()
    svc.register('other', { k: 'v' })
    expect(seen).toEqual([r0 + 1])
  })

  it('isolates a throwing subscriber: the rest still see the new revision', () => {
    const { svc } = make()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const seen: number[] = []
      svc.subscribe(() => { throw new Error('boom') })
      svc.subscribe(() => { seen.push(svc.getSnapshot().revision) })
      svc.register('ns', { k: 'v' })
      expect(seen).toEqual([1])
      expect(spy).toHaveBeenCalledOnce()
    } finally {
      spy.mockRestore()
    }
  })

  it('register disposer republishes (mounted outlets drop the dead dictionary)', () => {
    const { svc } = make()
    const dispose = svc.register('ns', { k: 'v' })
    const before = svc.getSnapshot().revision
    dispose()
    expect(svc.getSnapshot().revision).toBe(before + 1)
    // Second run hits the idempotent arm: nothing removed, no republish.
    dispose()
    expect(svc.getSnapshot().revision).toBe(before + 1)
  })
})
