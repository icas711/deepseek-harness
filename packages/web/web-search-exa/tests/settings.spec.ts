/** The `web-search-exa` settings section layered over the composition entry. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { credentialRef, CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsDescriptor, SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as exaPlugin from '@deepseek-ai/dsh-web-search-exa'
import { EXA_PROVIDER_ID, WEB_SEARCH_EXA_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-web-search-exa'

/** The smallest real settings provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** The smallest credential store: one in-memory map, always writable. */
class MemoryCredentials extends CredentialProvider {
  readonly store = new Map<string, string>()

  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.store.get(ref)
    return value !== undefined ? { value, source: 'memory' } : undefined
  }

  async describe(ref: CredentialRef): Promise<CredentialInfo> {
    return this.store.has(ref)
      ? { configured: true, source: 'memory', writable: true }
      : { configured: false, writable: true }
  }

  async set(ref: CredentialRef, value: string): Promise<void> {
    this.store.set(ref, value)
  }

  async unset(ref: CredentialRef): Promise<void> {
    this.store.delete(ref)
  }
}

interface Bench {
  ctx: Context
  settingsFiber: Fiber
  pluginFiber: Fiber
}

async function boot(config: exaPlugin.Config = {}, launchEnv?: LaunchEnvironmentSnapshot): Promise<Bench> {
  const ctx = new Context()
  if (launchEnv !== undefined) ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, launchEnv)
  await ctx.plugin(WebRuntime, { searchProvider: EXA_PROVIDER_ID })
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(exaPlugin, config)
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

/**
 * Run one search and report the endpoint and authorization header it reached.
 * A fresh `Response` per call because a body can only be read once, and the
 * call history is cleared because repeated `spyOn` returns the same spy.
 * @param ctx - context whose `ctx.web` serves the search.
 * @returns the URL and bearer header of the dispatched request.
 */
async function searchOnce(ctx: Context): Promise<{ url: string; authorization?: string }> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(jsonResponse({ results: [{ url: 'https://a.test', highlights: ['hi'] }] })))
  fetchSpy.mockClear()
  await ctx.web.search({ query: 'anything' })
  const last = fetchSpy.mock.calls.at(-1) as unknown as [string, RequestInit | undefined] | undefined
  const authorization = (last?.[1]?.headers as Record<string, string> | undefined)?.authorization
  return {
    url: String(last?.[0] ?? ''),
    ...authorization === undefined ? {} : { authorization },
  }
}

function describeSection(ctx: Context, redact = false): SettingsDescriptor | undefined {
  const [descriptor] = ctx.settings.describe(redact ? { redactSecrets: true } : undefined)
    .filter(row => String(row.ns) === 'web-search-exa')
  return descriptor
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('web-search-exa settings section', () => {
  it('serves a stored endpoint to the next search and marks the field overridden', async () => {
    const bench = await boot({ apiKey: 'exa-key', baseURL: 'https://search.entry.test' })
    expect((await searchOnce(bench.ctx)).url).toContain('https://search.entry.test')

    await bench.ctx.settings.update(WEB_SEARCH_EXA_SETTINGS_NAMESPACE, { baseURL: 'https://search.stored.test' })
    expect((await searchOnce(bench.ctx)).url).toContain('https://search.stored.test')

    const descriptor = describeSection(bench.ctx)
    expect(descriptor?.base).toMatchObject({ baseURL: 'https://search.entry.test' })
    expect(descriptor?.user).toEqual({ baseURL: 'https://search.stored.test' })
    expect(descriptor?.value).toMatchObject({ baseURL: 'https://search.stored.test', apiKeyEnv: 'EXA_API_KEY' })
    await bench.ctx.fiber.dispose()
  })

  it('returns to the composition entry when the user layer resets', async () => {
    const bench = await boot({ apiKey: 'exa-key', baseURL: 'https://search.entry.test' })
    await bench.ctx.settings.update(WEB_SEARCH_EXA_SETTINGS_NAMESPACE, { baseURL: 'https://search.stored.test' })
    expect((await searchOnce(bench.ctx)).url).toContain('https://search.stored.test')

    await bench.ctx.settings.replace(WEB_SEARCH_EXA_SETTINGS_NAMESPACE, {})

    const descriptor = describeSection(bench.ctx)
    expect(descriptor?.user).toEqual({})
    expect((await searchOnce(bench.ctx)).url).toContain('https://search.entry.test')
    await bench.ctx.fiber.dispose()
  })

  it('keeps the literal key out of every described layer', async () => {
    const bench = await boot({ apiKey: 'exa-key' })
    await bench.ctx.settings.update(WEB_SEARCH_EXA_SETTINGS_NAMESPACE, { apiKey: 'exa-stored-secret' })

    const descriptor = describeSection(bench.ctx, true)

    expect(JSON.stringify(descriptor)).not.toContain('exa-stored-secret')
    expect(descriptor?.secrets).toEqual([{ path: ['apiKey'], set: true }])
    await bench.ctx.fiber.dispose()
  })

  it('resolves an empty apiKeyEnv as the $EXA_API_KEY fallback', async () => {
    const prev = process.env.EXA_API_KEY
    process.env.EXA_API_KEY = 'env-key'
    try {
      const bench = await boot({ apiKeyEnv: '' })
      await bench.ctx.settings.update(WEB_SEARCH_EXA_SETTINGS_NAMESPACE, { apiKeyEnv: '' })
      expect(await searchOnce(bench.ctx)).toMatchObject({ authorization: 'Bearer env-key' })
      await bench.ctx.fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.EXA_API_KEY
      else process.env.EXA_API_KEY = prev
    }
  })

  it('resolves a custom apiKeyEnv through the credentials service', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: EXA_PROVIDER_ID })
    const credentialsFiber = ctx.plugin(MemoryCredentials)
    await credentialsFiber.await()
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    const pluginFiber = ctx.plugin(exaPlugin, {})
    await pluginFiber.await()
    await ctx.credentials.set(credentialRef('CUSTOM_EXA_KEY'), 'cred-key')
    await ctx.settings.update(WEB_SEARCH_EXA_SETTINGS_NAMESPACE, { apiKeyEnv: 'CUSTOM_EXA_KEY' })

    expect(await searchOnce(ctx)).toMatchObject({ authorization: 'Bearer cred-key' })
    await ctx.fiber.dispose()
  })

  it('fails the search naming the reference when the credentials entry is missing', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: EXA_PROVIDER_ID })
    const credentialsFiber = ctx.plugin(MemoryCredentials)
    await credentialsFiber.await()
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    const pluginFiber = ctx.plugin(exaPlugin, {})
    await pluginFiber.await()
    await ctx.settings.update(WEB_SEARCH_EXA_SETTINGS_NAMESPACE, { apiKeyEnv: 'ABSENT_EXA_KEY' })

    await expect(ctx.web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({
      code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
      message: expect.stringContaining('ABSENT_EXA_KEY'),
    }))
    await ctx.fiber.dispose()
  })

  it('fails the search when no source supplies a key', async () => {
    const prev = process.env.EXA_API_KEY
    delete process.env.EXA_API_KEY
    try {
      const bench = await boot({})
      await expect(bench.ctx.web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({
        code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
        message: expect.stringContaining('EXA_API_KEY'),
      }))
      await bench.ctx.fiber.dispose()
    } finally {
      if (prev !== undefined) process.env.EXA_API_KEY = prev
    }
  })

  it('treats an empty environment value as no key', async () => {
    const bench = await boot({}, createLaunchEnvironmentSnapshot([{ source: 'process', values: { EXA_API_KEY: '' } }]))
    await expect(bench.ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot({ apiKey: 'exa-key', baseURL: 'https://search.entry.test' })
    await bench.ctx.settings.update(WEB_SEARCH_EXA_SETTINGS_NAMESPACE, {
      baseURL: 'https://search.stored.test',
    })
    expect((await searchOnce(bench.ctx)).url).toContain('https://search.stored.test')

    await bench.settingsFiber.dispose()

    expect((await searchOnce(bench.ctx)).url).toContain('https://search.entry.test')
    await bench.ctx.fiber.dispose()
  })

  it('serves a switched apiKeyEnv to the next search without re-registering the provider', async () => {
    const prev = process.env.EXA_API_KEY
    delete process.env.EXA_API_KEY
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: EXA_PROVIDER_ID })
      const registerSpy = vi.spyOn(ctx.web, 'registerSearchProvider')
      const credentialsFiber = ctx.plugin(MemoryCredentials)
      await credentialsFiber.await()
      const settingsFiber = ctx.plugin(MemorySettings)
      await settingsFiber.await()
      const pluginFiber = ctx.plugin(exaPlugin, {})
      await pluginFiber.await()

      await ctx.credentials.set(credentialRef('FIRST_EXA_KEY'), 'first-key')
      await ctx.settings.update(WEB_SEARCH_EXA_SETTINGS_NAMESPACE, { apiKeyEnv: 'FIRST_EXA_KEY' })
      expect(await searchOnce(ctx)).toMatchObject({ authorization: 'Bearer first-key' })

      await ctx.credentials.set(credentialRef('SECOND_EXA_KEY'), 'second-key')
      await ctx.settings.update(WEB_SEARCH_EXA_SETTINGS_NAMESPACE, { apiKeyEnv: 'SECOND_EXA_KEY' })
      expect(await searchOnce(ctx)).toMatchObject({ authorization: 'Bearer second-key' })

      expect(registerSpy).toHaveBeenCalledTimes(1)
      await ctx.fiber.dispose()
    } finally {
      if (prev !== undefined) process.env.EXA_API_KEY = prev
    }
  })

  it('keeps the key value out of search results and error messages', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: EXA_PROVIDER_ID })
    const credentialsFiber = ctx.plugin(MemoryCredentials)
    await credentialsFiber.await()
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    const pluginFiber = ctx.plugin(exaPlugin, {})
    await pluginFiber.await()
    await ctx.credentials.set(credentialRef('CUSTOM_EXA_KEY'), 'secret-exa-value')
    await ctx.settings.update(WEB_SEARCH_EXA_SETTINGS_NAMESPACE, { apiKeyEnv: 'CUSTOM_EXA_KEY' })

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(jsonResponse({ results: [{ url: 'https://a.test', highlights: ['hi'] }] })))
    const result = await ctx.web.search({ query: 'anything' })
    expect(JSON.stringify(result)).not.toContain('secret-exa-value')
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer secret-exa-value')

    fetchSpy.mockImplementation(() => Promise.resolve(jsonResponse({ error: 'upstream says no' }, { status: 401 })))
    const caught = await ctx.web.search({ query: 'anything' }).then(() => undefined, (error: unknown) => error as Error)
    expect(caught?.message).toContain('upstream says no')
    expect(caught?.message).not.toContain('secret-exa-value')
    await ctx.fiber.dispose()
  })

  it('releases the namespace when the plugin unloads', async () => {
    const bench = await boot({ apiKey: 'exa-key' })
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('web-search-exa')

    await bench.pluginFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('web-search-exa')
    await bench.ctx.fiber.dispose()
  })
})
