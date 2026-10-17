import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import Notifier, { NotifierError } from '../src/index.ts'
import type { BindingRecord, NotificationRequest } from '../src/types.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Provider stub: captures deliveries, exposes the protected pairing completion. */
class StubNotifier extends Notifier {
  readonly delivered: { request: NotificationRequest; binding: BindingRecord }[] = []

  protected override async deliver(request: NotificationRequest, binding: BindingRecord): Promise<void> {
    this.delivered.push({ request, binding })
  }

  /** Test face over the protected completion. */
  async confirm(code: string, chatId: string): Promise<string> {
    return this.completeBinding(code, chatId)
  }
}

type StubConfig = { bindingsPath: string; bindingCodeTtlMs: number }

async function boot(configure?: (config: StubConfig) => StubConfig): Promise<StubNotifier> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-notifier-'))
  const base = { bindingsPath: join(root, 'telegram-bindings.json'), bindingCodeTtlMs: 900_000 }
  context = new Context()
  const fiber = context.plugin(StubNotifier, configure?.(base) ?? base)
  await fiber.await()
  return context.notifier as StubNotifier
}

const request = (kind: 'paused' | 'completed' = 'completed') => ({
  login: 'anna',
  kind,
  title: 'Перенести отчёты',
  sessionId: SessionId('s1'),
})

describe('Notifier seam', () => {
  it('drops requests from an unbound login without delivering', async () => {
    const notifier = await boot()
    await expect(notifier.send(request())).resolves.toBe('unbound')
    expect(notifier.delivered).toHaveLength(0)
  })

  it('binds through the pairing code and delivers to the bound destination', async () => {
    const notifier = await boot()
    const { code } = await notifier.beginBinding('anna')
    expect(code).toMatch(/^[0-9a-f]{8}$/)
    await expect(notifier.confirm(code, 'chat-777')).resolves.toBe('anna')
    const disk = JSON.parse(await readFile(join(root as string, 'telegram-bindings.json'), 'utf8')) as { version: number; bindings: { login: string; chatId: string }[] }
    expect(disk.version).toBe(1)
    expect(disk.bindings[0]).toMatchObject({ login: 'anna', chatId: 'chat-777' })
    await expect(notifier.send(request())).resolves.toBe('sent')
    expect(notifier.delivered[0]?.binding.chatId).toBe('chat-777')
    expect(notifier.delivered[0]?.request.sessionId).toBe(SessionId('s1'))
  })

  it('rejects unknown, consumed, and foreign codes with one loud code', async () => {
    const notifier = await boot()
    await expect(notifier.confirm('nope0000', 'chat-1')).rejects.toMatchObject({ code: 'unknown-code' })
    const { code } = await notifier.beginBinding('anna')
    await notifier.confirm(code, 'chat-777')
    await expect(notifier.confirm(code, 'chat-778')).rejects.toMatchObject({ code: 'unknown-code' })
  })

  it('expires codes past the configured lifetime', async () => {
    const notifier = await boot(base => ({ ...base, bindingCodeTtlMs: 1 }))
    const { code } = await notifier.beginBinding('anna')
    await new Promise(resolve => setTimeout(resolve, 10))
    await expect(notifier.confirm(code, 'chat-777')).rejects.toMatchObject({ code: 'unknown-code' })
    expect(notifier.delivered).toHaveLength(0)
  })

  it('invalidates a login’s previous code when a fresh one is minted', async () => {
    const notifier = await boot()
    const first = await notifier.beginBinding('anna')
    const second = await notifier.beginBinding('anna')
    expect(second.code).not.toBe(first.code)
    await expect(notifier.confirm(first.code, 'chat-1')).rejects.toMatchObject({ code: 'unknown-code' })
    await expect(notifier.confirm(second.code, 'chat-2')).resolves.toBe('anna')
  })

  it('keeps codes of different logins independent', async () => {
    const notifier = await boot()
    const anna = await notifier.beginBinding('anna')
    const oleg = await notifier.beginBinding('oleg')
    await expect(notifier.confirm(anna.code, 'chat-1')).resolves.toBe('anna')
    await expect(notifier.confirm(oleg.code, 'chat-2')).resolves.toBe('oleg')
  })

  it('enumerates bound logins in binding order', async () => {
    const notifier = await boot()
    await expect(notifier.boundLogins()).resolves.toEqual([])
    const anna = await notifier.beginBinding('anna')
    await notifier.confirm(anna.code, 'chat-1')
    const oleg = await notifier.beginBinding('oleg')
    await notifier.confirm(oleg.code, 'chat-2')
    await expect(notifier.boundLogins()).resolves.toEqual(['anna', 'oleg'])
  })

  it('rejects logins that cannot key a durable binding', async () => {
    const notifier = await boot()
    for (const login of ['', '   ', 'два слова', 'x'.repeat(129)]) {
      await expect(notifier.beginBinding(login)).rejects.toMatchObject({ code: 'invalid-login' })
    }
  })

  it('codes with a dashed word are valid logins', async () => {
    const notifier = await boot()
    const { code } = await notifier.beginBinding('anna.pem-1')
    await expect(notifier.confirm(code, 'chat-1')).resolves.toBe('anna.pem-1')
  })
})

describe('NotifierError', () => {
  it('carries the machine-readable code', () => {
    expect(new NotifierError('boom', 'unknown-code').code).toBe('unknown-code')
  })
})
