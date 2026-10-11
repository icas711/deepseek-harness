/**
 * Unit coverage for the web-identity plumbing: the AsyncLocalStorage the
 * fetch carrier enters, the root-containment rule shared by the scoping
 * points, and the identity resolution the gateway's points consume.
 */

import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { currentWebRequestHeaders, isWithinRoot, runWithWebRequestHeaders, scopingIdentity, type WebIdentity } from '../src/web-identity.ts'

describe('runWithWebRequestHeaders', () => {
  it('stores the headers for the serving pass and clears them after', async () => {
    const headers = new Headers({ cookie: 'a=1' })
    await runWithWebRequestHeaders(headers, async () => {
      expect(currentWebRequestHeaders()).toBe(headers)
      // The store rides async continuations of the same pass.
      await Promise.resolve()
      expect(currentWebRequestHeaders()).toBe(headers)
    })
    expect(currentWebRequestHeaders()).toBeUndefined()
  })

  it('keeps passes isolated under interleaving', async () => {
    const first = new Headers({ cookie: 'first=1' })
    const second = new Headers({ cookie: 'second=1' })
    const observed: (string | undefined)[] = []
    const a = runWithWebRequestHeaders(first, async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      observed.push(currentWebRequestHeaders()?.get('cookie') ?? undefined)
    })
    const b = runWithWebRequestHeaders(second, async () => {
      await new Promise(resolve => setTimeout(resolve, 1))
      observed.push(currentWebRequestHeaders()?.get('cookie') ?? undefined)
    })
    await Promise.all([a, b])
    expect(observed.sort()).toEqual(['first=1', 'second=1'])
  })
})

describe('isWithinRoot', () => {
  it('admits the root itself and its children, and refuses siblings and parents', () => {
    const root = process.platform === 'win32' ? 'C:\\work\\cab' : '/work/cab'
    const child = `${root}${process.platform === 'win32' ? '\\' : '/'}project`
    const sibling = `${root}-2`
    const parent = process.platform === 'win32' ? 'C:\\work' : '/work'
    expect(isWithinRoot(root, root)).toBe(true)
    expect(isWithinRoot(child, root)).toBe(true)
    expect(isWithinRoot(sibling, root)).toBe(false)
    expect(isWithinRoot(parent, root)).toBe(false)
  })

  it('compares case-insensitively on Windows', () => {
    const root = process.platform === 'win32' ? 'C:\\Work\\Cab' : '/work/cab'
    const child = process.platform === 'win32' ? 'c:\\work\\cab\\Sub' : '/work/cab/sub'
    expect(isWithinRoot(child, root)).toBe(true)
  })
})

describe('scopingIdentity', () => {
  /** A context stub whose webAuth service face the test controls. */
  function ctxWith(service: unknown): Context {
    return { get: (name: string) => (name === 'webAuth' ? service : undefined) } as unknown as Context
  }

  const scoped: WebIdentity = { login: 'bob', admin: false, root: '/work/cab' }

  it('answers undefined outside a web request, without the service, or without an identity', () => {
    expect(scopingIdentity(ctxWith({ identityFromCookie: () => scoped }))).toBeUndefined()
    runWithWebRequestHeaders(new Headers(), () => {
      expect(scopingIdentity(ctxWith(undefined))).toBeUndefined()
      expect(scopingIdentity(ctxWith({ identityFromCookie: () => undefined }))).toBeUndefined()
    })
  })

  it('answers the identity for a scoped user and undefined for an admin', () => {
    runWithWebRequestHeaders(new Headers({ cookie: 'dsh_web_session=abc' }), () => {
      const identityFor = (cookie: string | undefined) => (cookie === 'dsh_web_session=abc' ? scoped : undefined)
      expect(scopingIdentity(ctxWith({ identityFromCookie: identityFor }))).toBe(scoped)
      expect(scopingIdentity(ctxWith({ identityFromCookie: () => ({ ...scoped, admin: true }) }))).toBeUndefined()
    })
  })
})
