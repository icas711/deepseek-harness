/**
 * Coverage for the ended-session recovery: a 401 assigns the login page on a
 * real browser page; every other status (and every non-page caller) is inert.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { redirectToLoginWhenUnauthorized } from '../src/client/session-expired.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('redirectToLoginWhenUnauthorized', () => {
  it('assigns the login page for a 401 when a page location exists', () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { assign })
    redirectToLoginWhenUnauthorized(401)
    expect(assign).toHaveBeenCalledWith('/login')
  })

  it('leaves other statuses and location-less callers alone', () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { assign })
    redirectToLoginWhenUnauthorized(500)
    expect(assign).not.toHaveBeenCalled()
    vi.stubGlobal('location', undefined)
    expect(() => { redirectToLoginWhenUnauthorized(401) }).not.toThrow()
  })
})
