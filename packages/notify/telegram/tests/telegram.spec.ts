import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as TelegramRow from '../src/index.ts'
import { parseUpdate, resolveSpec, TelegramNotifier } from '../src/service.ts'
import type { ServiceConfig } from '../src/index.ts'
import { createFetchTransport, TelegramApiError, transportFactory } from '../src/transport.ts'
import type { TelegramTransport } from '../src/transport.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Transport double: records calls, queues updates, and fails on demand. */
class FakeTransport implements TelegramTransport {
  readonly calls: { method: string; payload: Record<string, unknown> }[] = []
  queue: unknown[] = []
  readonly failMethods = new Set<string>()

  async call(method: string, payload: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method, payload })
    if (this.failMethods.has(method)) throw new TelegramApiError(method, 'suppressed')
    if (method === 'getUpdates') {
      const out = this.queue
      this.queue = []
      return out
    }
    return true
  }

  push(...updates: unknown[]): void {
    this.queue.push(...updates)
  }

  sent(): { chatId: unknown; text: unknown }[] {
    return this.calls.filter(call => call.method === 'sendMessage').map(call => ({ chatId: call.payload.chat_id, text: call.payload.text }))
  }

  updateCalls(): Record<string, unknown>[] {
    return this.calls.filter(call => call.method === 'getUpdates').map(call => call.payload)
  }
}

/** Mount the provider over a fake transport. */
async function boot(config: Partial<ServiceConfig> = {}): Promise<{ notifier: TelegramNotifier; transport: FakeTransport }> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-telegram-'))
  const transport = new FakeTransport()
  const previous = transportFactory.create
  transportFactory.create = () => transport
  try {
    context = new Context()
    await context.plugin(TelegramNotifier, {
      botToken: 'test-token',
      bindingsPath: join(root, 'telegram-bindings.json'),
      pollIntervalMs: 50,
      watchIntervalMs: 50,
      ...config,
    }).await()
  } finally {
    transportFactory.create = previous
  }
  return { notifier: context.notifier as TelegramNotifier, transport }
}

/** One Bot API message update. */
function message(updateId: number, chatId: number | undefined, text: string | undefined): unknown {
  return {
    update_id: updateId,
    ...(chatId === undefined ? {} : { message: { chat: { id: chatId }, ...(text === undefined ? {} : { text }) } }),
  }
}

describe('passive mode', () => {
  it('mounts nothing without a token and never touches the transport factory', async () => {
    context = new Context()
    const previous = transportFactory.create
    let created = 0
    transportFactory.create = (botToken) => {
      created += 1
      return previous(botToken)
    }
    try {
      for (const botToken of [undefined, '', '   ']) {
        const fiber = context.plugin(TelegramRow, botToken === undefined ? {} : { botToken })
        await fiber.await()
        await fiber.dispose()
      }
    } finally {
      transportFactory.create = previous
    }
    expect(created).toBe(0)
    expect(context.get('notifier')).toBeUndefined()
  })

  it('mounts the provider beside a token, trimmed once', async () => {
    context = new Context()
    const previous = transportFactory.create
    const tokens: string[] = []
    transportFactory.create = (botToken) => {
      tokens.push(botToken)
      return previous(botToken)
    }
    try {
      await context.plugin(TelegramRow, { botToken: ' tok ', pollIntervalMs: 3_000 }).await()
    } finally {
      transportFactory.create = previous
    }
    expect(tokens).toEqual(['tok'])
    expect(context.get('notifier')).toBeDefined()
  })
})

describe('TelegramNotifier service', () => {
  it('completes a binding from /start КОД and confirms in Russian', async () => {
    const { notifier, transport } = await boot()
    const { code } = await notifier.beginBinding('anna')
    transport.push(message(7, 777, `/start ${code}`))
    await vi.waitFor(() => {
      expect(transport.sent()).toHaveLength(1)
    }, { timeout: 2_000, interval: 10 })
    expect(transport.sent()[0]).toMatchObject({ chatId: '777' })
    expect(String(transport.sent()[0]?.text)).toContain('Аккаунт «anna» привязан')
    const disk = JSON.parse(await readFile(join(root as string, 'telegram-bindings.json'), 'utf8')) as { bindings: { login: string; chatId: string }[] }
    expect(disk.bindings[0]).toMatchObject({ login: 'anna', chatId: '777' })
    // A consumed code answers with the rejection text on reuse.
    transport.push(message(8, 777, `/start ${code}`))
    await vi.waitFor(() => {
      expect(transport.sent()).toHaveLength(2)
    }, { timeout: 2_000, interval: 10 })
    expect(transport.sent()[1]?.text).toContain('Код не найдён или истёк')
  })

  it('delivers a notification to the bound chat with the configured link', async () => {
    const { notifier, transport } = await boot({ webBaseUrl: 'http://127.0.0.1:3080' })
    const { code } = await notifier.beginBinding('anna')
    transport.push(message(7, 777, `/start ${code}`))
    await vi.waitFor(() => {
      expect(transport.sent()).toHaveLength(1)
    }, { timeout: 2_000, interval: 10 })
    await expect(notifier.send({
      login: 'anna',
      kind: 'completed',
      title: 'Готовая',
      sessionId: SessionId('s3'),
    })).resolves.toBe('sent')
    expect(transport.sent()[1]?.text).toBe(
      'Задача завершена\n\nЗадача: «Готовая»\nОткрыть сессию: http://127.0.0.1:3080/session/s3',
    )
  })

  it('reports unbound for a login without a binding and sends nothing', async () => {
    const { notifier, transport } = await boot()
    await expect(notifier.send({
      login: 'nobody',
      kind: 'failed',
      title: 'Работа',
      sessionId: SessionId('s1'),
    })).resolves.toBe('unbound')
    expect(transport.sent()).toHaveLength(0)
  })

  it('hints on a non-/start message', async () => {
    const { transport } = await boot()
    transport.push(message(7, 777, 'привет'))
    await vi.waitFor(() => {
      expect(transport.sent()).toHaveLength(1)
    }, { timeout: 2_000, interval: 10 })
    expect(transport.sent()[0]?.text).toContain('Отправьте /start КОД')
  })

  it('hints on /start without a code', async () => {
    const { transport } = await boot()
    transport.push(message(7, 777, '/start'))
    await vi.waitFor(() => {
      expect(transport.sent()).toHaveLength(1)
    }, { timeout: 2_000, interval: 10 })
    expect(transport.sent()[0]?.text).toContain('Отправьте /start КОД')
  })

  it('rejects an unknown code without creating the bindings document', async () => {
    const { transport } = await boot()
    transport.push(message(7, 777, '/start nope0000'))
    await vi.waitFor(() => {
      expect(transport.sent()).toHaveLength(1)
    }, { timeout: 2_000, interval: 10 })
    expect(transport.sent()[0]?.text).toContain('Код не найдён или истёк')
    await expect(readFile(join(root as string, 'telegram-bindings.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('advances the getUpdates offset past handled updates', async () => {
    const { transport } = await boot()
    transport.push(message(7, 777, 'привет'))
    await vi.waitFor(() => {
      expect(transport.sent()).toHaveLength(1)
    }, { timeout: 2_000, interval: 10 })
    await vi.waitFor(() => {
      expect(transport.updateCalls().some(payload => payload.offset === 8)).toBe(true)
    }, { timeout: 2_000, interval: 10 })
  })

  it('skips malformed updates while keeping the flow alive', async () => {
    const { transport } = await boot()
    transport.push('junk', message(3, 5, undefined))
    await vi.waitFor(() => {
      expect(transport.sent()).toHaveLength(1)
    }, { timeout: 2_000, interval: 10 })
    expect(transport.sent()[0]?.chatId).toBe('5')
    await vi.waitFor(() => {
      expect(transport.updateCalls().some(payload => payload.offset === 4)).toBe(true)
    }, { timeout: 2_000, interval: 10 })
  })

  it('ignores updates without a chat', async () => {
    const { transport } = await boot()
    transport.push(message(9, undefined, undefined))
    await vi.waitFor(() => {
      expect(transport.updateCalls().some(payload => payload.offset === 10)).toBe(true)
    }, { timeout: 2_000, interval: 10 })
    expect(transport.sent()).toHaveLength(0)
  })

  it('keeps polling after a transport failure', async () => {
    const { transport } = await boot()
    transport.failMethods.add('getUpdates')
    await vi.waitFor(() => {
      expect(transport.updateCalls()).toHaveLength(1)
    }, { timeout: 2_000, interval: 10 })
    transport.failMethods.delete('getUpdates')
    await vi.waitFor(() => {
      expect(transport.updateCalls().length).toBeGreaterThan(1)
    }, { timeout: 2_000, interval: 10 })
  })

  it('answers with the failure text and keeps the code when the commit fails', async () => {
    const { notifier, transport } = await boot()
    const { code } = await notifier.beginBinding('anna')
    await writeFile(join(root as string, 'telegram-bindings.json'), 'junk', 'utf8')
    transport.push(message(7, 777, `/start ${code}`))
    await vi.waitFor(() => {
      expect(transport.sent()).toHaveLength(1)
    }, { timeout: 2_000, interval: 10 })
    expect(transport.sent()[0]?.text).toBe('Не удалось сохранить привязку. Попробуйте ещё раз.')
    // The code stays pending: after the document is repaired, the same code binds.
    await rm(join(root as string, 'telegram-bindings.json'), { force: true })
    transport.push(message(8, 778, `/start ${code}`))
    await vi.waitFor(() => {
      expect(transport.sent()).toHaveLength(2)
    }, { timeout: 2_000, interval: 10 })
    expect(String(transport.sent()[1]?.text)).toContain('Аккаунт «anna» привязан')
  })

  it('survives a failing failure-reply without an unhandled rejection', async () => {
    const { notifier, transport } = await boot()
    const { code } = await notifier.beginBinding('anna')
    await writeFile(join(root as string, 'telegram-bindings.json'), 'junk', 'utf8')
    transport.failMethods.add('sendMessage')
    transport.push(message(7, 777, `/start ${code}`))
    await vi.waitFor(() => {
      expect(transport.sent()).toHaveLength(1)
    }, { timeout: 2_000, interval: 10 })
    transport.failMethods.delete('sendMessage')
    transport.push(message(9, 777, 'привет'))
    await vi.waitFor(() => {
      expect(transport.sent().length).toBeGreaterThan(1)
    }, { timeout: 2_000, interval: 10 })
  })

  it('stops both loops on disposal', async () => {
    const { transport } = await boot()
    await vi.waitFor(() => {
      expect(transport.updateCalls().length).toBeGreaterThan(0)
    }, { timeout: 2_000, interval: 10 })
    await context?.fiber.dispose()
    context = undefined
    const count = transport.calls.length
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(transport.calls).toHaveLength(count)
  })

  it('rejects a poll interval under the floor', async () => {
    root ??= await mkdtemp(join(tmpdir(), 'dsh-telegram-'))
    const previous = transportFactory.create
    transportFactory.create = () => new FakeTransport()
    try {
      context = new Context()
      await expect(context.plugin(TelegramNotifier, {
        botToken: 'test-token',
        bindingsPath: join(root, 'telegram-bindings.json'),
        pollIntervalMs: 49,
      }).await()).rejects.toThrow()
    } finally {
      transportFactory.create = previous
    }
  })
})

describe('resolveSpec', () => {
  it('applies the documented defaults and trims the inputs', () => {
    const spec = resolveSpec({ botToken: ' tok ', bindingsPath: 'b.json', bindingCodeTtlMs: 5, pollIntervalMs: 60, watchIntervalMs: 70, webBaseUrl: ' http://h/ ' })
    expect(spec.botToken).toBe('tok')
    expect(spec.bindingsPath).toBe('b.json')
    expect(spec.bindingCodeTtlMs).toBe(5)
    expect(spec.pollIntervalMs).toBe(60)
    expect(spec.watchIntervalMs).toBe(70)
    expect(spec.webBaseUrl).toBe('http://h/')
    const defaulted = resolveSpec({ botToken: 'tok' })
    expect(defaulted.bindingsPath.endsWith('telegram-bindings.json')).toBe(true)
    expect(defaulted.bindingCodeTtlMs).toBe(900_000)
    expect(defaulted.pollIntervalMs).toBe(3_000)
    expect(defaulted.watchIntervalMs).toBe(15_000)
    expect(defaulted.webBaseUrl).toBeUndefined()
  })
})

describe('parseUpdate', () => {
  it('parses numeric and string chat ids and tolerates missing parts', () => {
    expect(parseUpdate(message(1, 42, 'текст'))).toEqual({ updateId: 1, chatId: '42', text: 'текст' })
    expect(parseUpdate({ update_id: 2, message: { chat: { id: '777' }, text: 'т' } })).toEqual({ updateId: 2, chatId: '777', text: 'т' })
    expect(parseUpdate(message(3, undefined, undefined))).toEqual({ updateId: 3, chatId: undefined, text: undefined })
    expect(parseUpdate({ update_id: 'x' })).toBeUndefined()
    expect(parseUpdate(null)).toBeUndefined()
    expect(parseUpdate({ message: { chat: { id: 1 } } })).toBeUndefined()
  })
})

describe('fetch transport', () => {
  it('round-trips one method over fetch', async () => {
    const calls: { url: string; init: unknown }[] = []
    vi.stubGlobal('fetch', async (url: string, init: unknown) => {
      calls.push({ url, init })
      return { status: 200, text: async () => JSON.stringify({ ok: true, result: [1, 2] }) }
    })
    try {
      const result = await createFetchTransport('tok').call('getUpdates', { offset: 0 })
      expect(result).toEqual([1, 2])
      expect(calls[0]?.url).toBe('https://api.telegram.org/bottok/getUpdates')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('carries the API description on ok:false and non-JSON bodies', async () => {
    vi.stubGlobal('fetch', async () => ({ status: 400, text: async () => JSON.stringify({ ok: false, description: 'bad token' }) }))
    try {
      await expect(createFetchTransport('tok').call('getUpdates', {})).rejects.toThrow(/bad token/)
    } finally {
      vi.unstubAllGlobals()
    }
    vi.stubGlobal('fetch', async () => ({ status: 502, text: async () => 'gateway junk' }))
    try {
      await expect(createFetchTransport('tok').call('sendMessage', {})).rejects.toThrow(/non-JSON response \(HTTP 502\)/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports network failures through the same error type', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    try {
      await expect(createFetchTransport('tok').call('getUpdates', {})).rejects.toThrow(/network failure: offline/)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
