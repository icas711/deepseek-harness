import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '../src/config.ts'
import { withZaiMcpServer, ZAI_MCP_SERVER_TOOL } from '../src/zai-mcp.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

/** Real composition over provider routes whose endpoint is the mock server. */
async function harness(providers: Record<string, LlmPiAi.PiAiProviderProfile>): Promise<Context> {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers })
  return ctx
}

const PING: ToolSchema = { name: 'ping', description: 'answers pong', parameters: { type: 'object', properties: {} } }

/** The captured request's wire tools, by type and function name. */
function wireToolsOf(request: unknown): { type: string; function?: { name: string } }[] {
  return (request as { tools: { type: string; function?: { name: string } }[] }).tools
}

describe('withZaiMcpServer', () => {
  it('appends the MCP server entry after existing function tools', () => {
    expect(withZaiMcpServer({ model: 'glm-4.7', stream: true, tools: [{ type: 'function', function: { name: 'ping' } }] })).toEqual({
      model: 'glm-4.7',
      stream: true,
      tools: [{ type: 'function', function: { name: 'ping' } }, ZAI_MCP_SERVER_TOOL],
    })
  })

  it('creates the tools array when the request declares none', () => {
    expect(withZaiMcpServer({ model: 'glm-4.7', stream: true })).toEqual({
      model: 'glm-4.7',
      stream: true,
      tools: [ZAI_MCP_SERVER_TOOL],
    })
  })

  it('refuses a payload shape it cannot compose with', () => {
    expect(() => withZaiMcpServer('glm-4.7')).toThrow(/non-object request payload/)
    expect(() => withZaiMcpServer({ tools: 'none' })).toThrow(/tools field is not an array/)
  })
})

describe('profile mcp switch', () => {
  it('is refused on a route that is not a Z.AI route', () => {
    expect(() => resolveProfiles({
      'acme-gateway': {
        api: 'openai-completions',
        baseURL: 'https://gateway.acme.example/v1',
        models: [{ id: 'acme-large' }],
        mcp: true,
      },
    })).toThrow(/"acme-gateway" sets mcp, which only a Z.AI route serves/)
  })

  it('carries the MCP server entry on a zai route request without harness tools', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness({ zai: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url, mcp: true } })
    const result = await assemble(ctx, {
      provider: 'zai',
      model: 'glm-4.7',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(server.requests[0]).toEqual(
      expect.objectContaining({ model: 'glm-4.7', tools: [ZAI_MCP_SERVER_TOOL] }),
    )
  })

  it('appends the MCP server entry after the harness function tools', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness({ zai: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url, mcp: true } })
    await assemble(ctx, { provider: 'zai', model: 'glm-4.7', messages: [], tools: [PING] })
    const tools = wireToolsOf(server.requests[0])
    expect(tools.map(tool => tool.type)).toEqual(['function', 'mcp'])
    expect(tools[0]?.function?.name).toBe('ping')
    expect(tools[1]).toEqual(ZAI_MCP_SERVER_TOOL)
  })

  it('omits the entry when the profile does not enable mcp', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness({ zai: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    await assemble(ctx, { provider: 'zai', model: 'glm-4.7', messages: [], tools: [PING] })
    const tools = wireToolsOf(server.requests[0])
    expect(tools.map(tool => tool.type)).toEqual(['function'])
    expect(tools[0]?.function?.name).toBe('ping')
  })
})
