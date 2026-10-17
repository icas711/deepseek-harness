// Real composition through the Loader: the task-supervisor row and the
// telegram-notifier row mount together, a pairing code completes over the
// substituted transport, and a task marked failed reaches the bound chat as
// an ordinary watcher notification.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { SessionId } from '@deepseek-ai/dsh-session'
import TaskSupervisor from '@deepseek-ai/dsh-task-supervisor'
import * as TelegramRow from '../src/index.ts'
import { transportFactory } from '../src/transport.ts'
import type { TelegramTransport } from '../src/transport.ts'

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.fiber.dispose()
  }
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Transport double shared by the test. */
class FakeTransport implements TelegramTransport {
  readonly calls: { method: string; payload: Record<string, unknown> }[] = []
  queue: unknown[] = []
  async call(method: string, payload: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method, payload })
    if (method === 'getUpdates') {
      const out = this.queue
      this.queue = []
      return out
    }
    return true
  }
}

/**
 * Boot the two-row composition through the real Loader.
 */
async function boot(): Promise<Context> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-telegram-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-task-supervisor'",
    '  config:',
    `      registryPath: '${join(root, 'task-registry.json').replace(/\\/g, '/')}'`,
    "- name: '@deepseek-ai/dsh-telegram-notifier'",
    '  config:',
    '      botToken: test-token',
    `      bindingsPath: '${join(root, 'telegram-bindings.json').replace(/\\/g, '/')}'`,
    '      pollIntervalMs: 50',
    '      watchIntervalMs: 50',
    '',
  ].join('\n'))
  const context = new Context()
  contexts.push(context)
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-task-supervisor', TaskSupervisor],
    ['@deepseek-ai/dsh-telegram-notifier', TelegramRow],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('telegram-notifier Loader composition', () => {
  it('pairs a chat and notifies a failed task end-to-end', async () => {
    const transport = new FakeTransport()
    const previous = transportFactory.create
    transportFactory.create = () => transport
    try {
      const context = await boot()
      const { code } = await context.notifier.beginBinding('anna')
      transport.queue.push({ update_id: 1, message: { chat: { id: 777 }, text: `/start ${code}` } })
      await vi.waitFor(() => {
        const confirmation = transport.calls.find(call => call.method === 'sendMessage')
        expect((confirmation?.payload.text as string | undefined) ?? '').toContain('Аккаунт «anna» привязан')
      }, { timeout: 5_000, interval: 25 })

      const task = await context.taskSupervisor.track({ sessionId: SessionId('s1'), title: 'Перенести отчёты' })
      await context.taskSupervisor.markFailed(task.taskId, 'сеть недоступна')
      await vi.waitFor(() => {
        const notifications = transport.calls.filter(call => call.method === 'sendMessage')
        expect(notifications.some(call => (call.payload.text as string).startsWith('Задача провалена'))).toBe(true)
      }, { timeout: 5_000, interval: 25 })

      const disk = JSON.parse(await readFile(join(root as string, 'telegram-bindings.json'), 'utf8')) as { bindings: { login: string; chatId: string }[] }
      expect(disk.bindings[0]).toMatchObject({ login: 'anna', chatId: '777' })
    } finally {
      transportFactory.create = previous
    }
  }, 30_000)
})
