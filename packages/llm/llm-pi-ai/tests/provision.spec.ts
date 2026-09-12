/**
 * Z.AI route provisioning through the real composition: the plugin's
 * registered provisioning writes the settings section the way a key save on
 * the Models page ends at — snapshot models plus the live listing — with the
 * documented GLM-5.3 facts applied and the stored corrections kept.
 */
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { isZaiRoute } from '../src/provision.ts'

const NS = settingsNamespace('llm-pi-ai')

const cleanups: Array<() => Promise<void>> = []
const servers: Server[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  while (cleanups.length > 0) await cleanups.pop()!()
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pi-provision-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** Real composition: settings and credential seams mounted, plugin dormant. */
async function boot(dir: string, credentials: string): Promise<Context> {
  await writeFile(join(dir, '.credentials.yaml'), credentials, { mode: 0o600 })
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
  })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(LlmPiAi, {})
  return ctx
}

/** A stand-in provider answering one `GET /models` with ids only, as Z.AI's does. */
async function listingServer(): Promise<string> {
  const body = JSON.stringify({ data: [{ id: 'glm-5.3-flash' }, { id: 'glm-4.7' }, { id: 'brand-new' }] })
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) })
    response.end(body)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return `http://127.0.0.1:${address.port}`
}

/** Seed one route's stored profile the way a Models-page save leaves it. */
async function seedProfile(dir: string, provider: string, fields: string[]): Promise<void> {
  const lines = ['llm-pi-ai:', '  providers:', `    ${provider}:`, ...fields.map(field => `      ${field}`)]
  await writeFile(join(dir, 'settings.yaml'), `${lines.join('\n')}\n`, { mode: 0o600 })
}

describe('zai route gating', () => {
  it('accepts a catalog route, a documented host, and nothing else', () => {
    expect(isZaiRoute('zai', undefined)).toBe(true)
    expect(isZaiRoute('zai-coding-cn', undefined)).toBe(true)
    expect(isZaiRoute('acme-gateway', undefined)).toBe(false)
    expect(isZaiRoute('acme-gateway', { baseURL: 'https://api.z.ai/api/paas/v4' })).toBe(true)
    expect(isZaiRoute('acme-gateway', { baseURL: 'https://gateway.acme.example/v1' })).toBe(false)
    // A malformed stored endpoint names no Z.AI host and fails later where the
    // endpoint is actually used, with the URL in the message.
    expect(isZaiRoute('acme-gateway', { baseURL: '::not a url::' })).toBe(false)
  })
})

describe('zai route provisioning', () => {
  it('stamps the zai catalog routes as provisionable the moment the plugin mounts', async () => {
    const dir = await home()
    const ctx = await boot(dir, 'ZAI_API_KEY: from-file\n')
    const directory = ctx.llm.listConfigurableProviders()
    expect(directory.find(entry => entry.provider === 'zai')).toMatchObject({ provisionable: true })
    expect(directory.find(entry => entry.provider === 'zai-coding-cn')).toMatchObject({ provisionable: true })
    expect(directory.find(entry => entry.provider === 'openai')?.provisionable).toBeUndefined()
  })

  it('builds both catalog routes from nothing, each naming its own credential reference', async () => {
    // The onboarding posture: a saved key, no stored profile. The endpoint is
    // the catalog route's own, answered here by a stubbed fetch.
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      JSON.stringify({ data: [{ id: 'glm-5.3-flash' }, { id: 'glm-4.7' }, { id: 'brand-new' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const dir = await home()
    await writeFile(join(dir, '.credentials.yaml'), 'ZAI_CODING_CN_API_KEY: from-file\n', { mode: 0o600 })
    const ctx = new Context()
    cleanups.push(async () => {
      await ctx.fiber.dispose()
    })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
    await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await ctx.plugin(LlmPiAi, {})

    await expect(ctx.llm.provisionProvider(NS, { provider: 'zai-coding-cn' })).resolves.toEqual({ models: 3 })

    const section = (ctx.get('settings')!.get(NS) ?? {}) as LlmPiAi.Config
    expect(section.providers?.['zai-coding-cn']?.apiKeyEnv).toBe('ZAI_CODING_CN_API_KEY')
    expect(section.providers?.['zai-coding-cn']?.baseURL).toContain('open.bigmodel.cn')
  })

  it('refuses a route with no stored profile and no Z.AI template', async () => {
    const dir = await home()
    const ctx = await boot(dir, 'ZAI_API_KEY: from-file\n')

    await expect(ctx.llm.provisionProvider(NS, { provider: 'not-a-real-route' }))
      .rejects.toMatchObject({ code: 'INVALID_PROVISION' })
  })

  it('provisions a stored zai-host route that names no credential reference', async () => {
    // Provider-native discovery posture: the profile names no apiKeyEnv, the
    // fetch goes out unauthenticated, and the built profile stays that way.
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      JSON.stringify({ data: [{ id: 'glm-5.3-flash' }, { id: 'glm-5.3' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const url = 'https://api.z.ai/api/paas/v4'
    const dir = await home()
    await seedProfile(dir, 'zai', [`baseURL: ${url}`])
    const ctx = await boot(dir, '')

    await expect(ctx.llm.provisionProvider(NS, { provider: 'zai' })).resolves.toEqual({ models: 2 })

    const section = (ctx.get('settings')!.get(NS) ?? {}) as LlmPiAi.Config
    const profile = section.providers?.zai
    expect(profile?.apiKeyEnv).toBeUndefined()
    expect(profile?.liveModels).toBe(true)
    // The non-flash family member is text-only; the flash one takes images.
    expect(profile?.models).toEqual([
      {
        id: 'glm-5.3-flash',
        contextWindow: 1_048_576,
        maxTokens: 131_072,
        input: ['text', 'image'],
        reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
        compat: { thinkingFormat: 'zai', supportsReasoningEffort: true },
      },
      {
        id: 'glm-5.3',
        contextWindow: 1_048_576,
        maxTokens: 131_072,
        input: ['text'],
        reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
        compat: { thinkingFormat: 'zai', supportsReasoningEffort: true },
      },
    ])
  })

  it('fails loud when the composition mounts no settings service to write through', async () => {
    // The credential resolves from the launch environment without the seam;
    // the listing succeeds, and the missing write target is what fails.
    vi.stubEnv('ZAI_API_KEY', 'from-env')
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      JSON.stringify({ data: [{ id: 'glm-4.7' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const ctx = new Context()
    cleanups.push(async () => {
      await ctx.fiber.dispose()
    })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {})

    await expect(ctx.llm.provisionProvider(NS, { provider: 'zai' }))
      .rejects.toMatchObject({ code: 'PROVISION_FAILED' })
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('builds the first profile from the catalog template and the endpoint listing', async () => {
    // The onboarding posture: a saved key, no stored profile. The endpoint is
    // the catalog route's own, answered here by a stubbed fetch.
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      JSON.stringify({ data: [{ id: 'glm-5.3-flash' }, { id: 'glm-4.7' }, { id: 'brand-new' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const dir = await home()
    const ctx = await boot(dir, 'ZAI_API_KEY: from-file\n')

    await expect(ctx.llm.provisionProvider(NS, { provider: 'zai' })).resolves.toEqual({ models: 3 })

    const section = (ctx.get('settings')!.get(NS) ?? {}) as LlmPiAi.Config
    const profile = section.providers?.zai
    expect(profile).toMatchObject({
      apiKeyEnv: 'ZAI_API_KEY',
      liveModels: true,
      defaultContextWindow: 1_048_576,
      defaultMaxTokens: 131_072,
      reasoning: 'max',
    })
    expect(profile?.baseURL).toContain('api.z.ai')
    // The documented family facts ride the snapshot; catalog models stay bare
    // and inherit; the endpoint's extra model gets the route defaults. The
    // read-back shows the schema's materialized form of a bare entry.
    expect(profile?.models).toEqual([
      {
        id: 'glm-5.3-flash',
        contextWindow: 1_048_576,
        maxTokens: 131_072,
        input: ['text', 'image'],
        reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
        compat: { thinkingFormat: 'zai', supportsReasoningEffort: true },
      },
      { id: 'glm-4.7', input: [], compat: {} },
      { id: 'brand-new', input: [], compat: {} },
    ])
  })

  it('keeps a stored correction while refreshing which models the route serves', async () => {
    const url = await listingServer()
    const dir = await home()
    await seedProfile(dir, 'zai', ['apiKeyEnv: ZAI_API_KEY', `baseURL: ${url}`])
    const ctx = await boot(dir, 'ZAI_API_KEY: from-file\n')
    await ctx.settings.update(NS, {
      providers: { zai: { apiKeyEnv: 'ZAI_API_KEY', baseURL: url, models: [{ id: 'glm-4.7', contextWindow: 123 }] } },
    })

    await expect(ctx.llm.provisionProvider(NS, { provider: 'zai' })).resolves.toEqual({ models: 3 })

    const section = (ctx.get('settings')!.get(NS) ?? {}) as LlmPiAi.Config
    const profile = section.providers?.zai
    expect(profile?.liveModels).toBe(true)
    // The user's correction survives verbatim; the family entry is built; the
    // endpoint's extra id joins and inherits the route defaults.
    expect(profile?.models).toEqual([
      {
        id: 'glm-5.3-flash',
        contextWindow: 1_048_576,
        maxTokens: 131_072,
        input: ['text', 'image'],
        reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
        compat: { thinkingFormat: 'zai', supportsReasoningEffort: true },
      },
      { id: 'glm-4.7', contextWindow: 123, input: [], compat: {} },
      { id: 'brand-new', input: [], compat: {} },
    ])
  })

  it('refuses a route that is not a Z.AI route and leaves nothing behind', async () => {
    const url = await listingServer()
    const dir = await home()
    await seedProfile(dir, 'acme-gateway', [
      'apiKeyEnv: ACME_GATEWAY_API_KEY',
      `baseURL: ${url}`,
      'api: openai-completions',
      'models:',
      '  - id: acme',
    ])
    const ctx = await boot(dir, 'ACME_GATEWAY_API_KEY: from-file\n')

    await expect(ctx.llm.provisionProvider(NS, { provider: 'acme-gateway' }))
      .rejects.toMatchObject({ code: 'NOT_PROVISIONABLE' })
    const section = (ctx.get('settings')!.get(NS) ?? {}) as LlmPiAi.Config
    expect(section.providers?.['acme-gateway']?.models).toEqual([{ id: 'acme', input: [], compat: {} }])
    expect(section.providers?.['acme-gateway']?.liveModels).toBeUndefined()
  })
  it('keeps the stored profile on an endpoint failure', async () => {
    // Accepts connections and destroys every socket, so the fetch fails.
    const server = createServer(() => { /* no reply */ })
    servers.push(server)
    server.on('connection', socket => socket.destroy())
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    const url = `http://127.0.0.1:${address.port}`
    const dir = await home()
    await seedProfile(dir, 'zai', ['apiKeyEnv: ZAI_API_KEY', `baseURL: ${url}`])
    const ctx = await boot(dir, 'ZAI_API_KEY: from-file\n')

    await expect(ctx.llm.provisionProvider(NS, { provider: 'zai' })).rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
    const section = (ctx.get('settings')!.get(NS) ?? {}) as LlmPiAi.Config
    expect(section.providers?.zai).toMatchObject({ baseURL: url, apiKeyEnv: 'ZAI_API_KEY' })
    expect(section.providers?.zai?.liveModels).toBeUndefined()
  })
})
