// The model-facing fleet tools: truncation boundaries, registration through the
// real Loader, and the owner-session fence for a non-agent caller.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Worktrees from '@deepseek-ai/dsh-worktree'
import Fleet from '@deepseek-ai/dsh-fleet'
import * as ToolFleet from '@deepseek-ai/dsh-tool-fleet'
import { truncateUtf8 } from '@deepseek-ai/dsh-tool-fleet'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot the tool-fleet composition through the real Loader from a cordis.yml. */
async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-tool-fleet-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-subprocess-local'",
    "- name: '@deepseek-ai/dsh-worktree'",
    "- name: '@deepseek-ai/dsh-fleet'",
    "- name: '@deepseek-ai/dsh-tool-fleet'",
    '  config:',
    '    maxDiffBytes: 512',
    '',
  ].join('\n'))
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-subprocess-local', SubprocessLocal],
    ['@deepseek-ai/dsh-worktree', Worktrees],
    ['@deepseek-ai/dsh-fleet', Fleet],
    ['@deepseek-ai/dsh-tool-fleet', ToolFleet],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('truncateUtf8', () => {
  it('keeps short text verbatim and never splits a code point', () => {
    expect(truncateUtf8('abc', 16)).toBe('abc')
    const emoji = '😀'.repeat(10)
    const cut = truncateUtf8(emoji, 5)
    expect(Buffer.byteLength(cut.split('\n')[0]!)).toBe(4)
    expect(cut).toContain('[truncated')
    const multibyte = 'éééééééééé'
    expect(truncateUtf8(multibyte, 4).startsWith('éé')).toBe(true)
  })
})

describe('tool-fleet real Loader composition', () => {
  it('registers the five fleet tools', async () => {
    const ctx = await boot()
    const names = ctx.tools.schemas().map(schema => schema.name)
    for (const name of ['fleet_fanout', 'fleet_status', 'fleet_diff', 'fleet_merge', 'fleet_cleanup']) {
      expect(names).toContain(name)
    }
  })

  it('rejects a non-agent caller with no owning session', async () => {
    const ctx = await boot()
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'fleet-no-agent' as never,
      name: 'fleet_status',
      arguments: {},
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('owning agent session')
  })
})
