/** Юнит-тесты бэкоффа: рост, потолок, джиттер в границах. */

import { describe, expect, it } from 'vitest'
import { nextBackoffMs, RECONNECT_INITIAL_MS, RECONNECT_MAX_MS } from '../src/backoff.ts'

describe('nextBackoffMs', () => {
  it('растёт экспоненциально и упирается в потолок', () => {
    expect(nextBackoffMs(0, () => 0.5)).toBeGreaterThanOrEqual(RECONNECT_INITIAL_MS * 0.8)
    expect(nextBackoffMs(0, () => 0.5)).toBeLessThanOrEqual(RECONNECT_INITIAL_MS * 1.2)
    expect(nextBackoffMs(10, () => 0.5)).toBe(Math.round(RECONNECT_MAX_MS))
  })

  it('джиттер держится в границах ±20%', () => {
    let random = 0
    const low = nextBackoffMs(1, () => random)
    random = 1
    const high = nextBackoffMs(1, () => random)
    const middle = RECONNECT_INITIAL_MS * 2
    expect(low).toBeGreaterThanOrEqual(middle * 0.8)
    expect(high).toBeLessThanOrEqual(middle * 1.2)
    expect(low).toBeLessThan(high)
  })

  it('не падает ниже 250 мс даже при отрицательном джиттере', () => {
    expect(nextBackoffMs(0, () => 0)).toBeGreaterThanOrEqual(250)
  })
})
