import { describe, expect, it } from 'vitest'
import { createConnectionHealthStore } from '../src/client/connection-health.ts'

describe('connectionHealth store', () => {
  it('starts at connecting, publishes each generation state to subscribers, and stops after unsubscribe', () => {
    const store = createConnectionHealthStore()
    expect(store.getSnapshot()).toBe('connecting')
    const seen: string[] = []
    const off = store.subscribe(() => { seen.push(store.getSnapshot()) })
    store.set('reconnecting')
    store.set('connected')
    off()
    store.set('connected')
    expect(seen).toEqual(['reconnecting', 'connected'])
    expect(store.getSnapshot()).toBe('connected')
  })
})
