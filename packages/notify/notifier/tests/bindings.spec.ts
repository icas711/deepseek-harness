import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BindingFileError, BindingStore, parseBindingsDocument, serializeBindingsDocument } from '../src/bindings.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function makePath(seed?: unknown): Promise<string> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-notifier-bindings-'))
  const filePath = join(root, 'telegram-bindings.json')
  if (seed !== undefined) await writeFile(filePath, JSON.stringify(seed, null, 2), 'utf8')
  return filePath
}

describe('BindingStore', () => {
  it('round-trips a binding through the durable document', async () => {
    const filePath = await makePath()
    const first = new BindingStore(filePath)
    await first.load()
    await first.bind('anna', '777')
    const second = new BindingStore(filePath)
    await second.load()
    expect(second.get('anna')?.chatId).toBe('777')
    expect(typeof second.get('anna')?.boundAt).toBe('number')
  })

  it('treats an absent document as an empty store', async () => {
    const filePath = await makePath()
    const store = new BindingStore(filePath)
    await store.load()
    expect(store.get('anna')).toBeUndefined()
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails loud on a corrupt document', async () => {
    root ??= await mkdtemp(join(tmpdir(), 'dsh-notifier-bindings-'))
    const filePath = join(root, 'telegram-bindings.json')
    await writeFile(filePath, 'not json', 'utf8')
    const store = new BindingStore(filePath)
    await expect(store.load()).rejects.toThrow(BindingFileError)
  })

  it('fails loud on a foreign version or a malformed record', async () => {
    await expect(new BindingStore(await makePath({ version: 2, bindings: [] })).load()).rejects.toThrow(/version/)
    await expect(new BindingStore(await makePath({ version: 1, bindings: [{ login: 'a b', chatId: '1', boundAt: 1 }] })).load())
      .rejects.toThrow(/malformed login/)
    await expect(new BindingStore(await makePath({ version: 1, bindings: [{ login: 'a', chatId: '', boundAt: 1 }] })).load())
      .rejects.toThrow(/malformed chatId/)
    await expect(new BindingStore(await makePath({ version: 1, bindings: [{ login: 'a', chatId: '1', boundAt: 1.5 }] })).load())
      .rejects.toThrow(/non-integer boundAt/)
  })

  it('merges under the lock: another login survives, rebinding overwrites', async () => {
    const filePath = await makePath({ version: 1, bindings: [{ login: 'anna', chatId: 'old', boundAt: 1 }] })
    const store = new BindingStore(filePath)
    await store.load()
    await store.bind('oleg', '888')
    await store.bind('anna', 'new')
    const disk = parseBindingsDocument(await readFile(filePath, 'utf8'), filePath)
    expect(disk).toHaveLength(2)
    expect(disk.find(record => record.login === 'oleg')?.chatId).toBe('888')
    const rebound = disk.find(record => record.login === 'anna')
    expect(rebound?.chatId).toBe('new')
    expect(rebound?.boundAt).toBeGreaterThan(1)
  })
})

describe('document format', () => {
  it('renders the complete document with a trailing newline', () => {
    const text = serializeBindingsDocument([{ login: 'anna', chatId: '777' as never, boundAt: 5 }])
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual({ version: 1, bindings: [{ login: 'anna', chatId: '777', boundAt: 5 }] })
  })

  it('names the document and the reason in parse failures', () => {
    expect(() => parseBindingsDocument('[]', '/tmp/telegram-bindings.json')).toThrow(/telegram-bindings\.json.*not a bindings document/s)
  })
})
