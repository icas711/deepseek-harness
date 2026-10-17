/**
 * Юнит-тесты реестра станций: разбор документа на границе носителя
 * (битый документ громко падает), слияние при записи под writer-lock,
 * откат памяти при сбое коммита.
 */

import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StationId } from '@deepseek-ai/dsh-station-protocol'
import { parseRegistryDocument, RegistryFileError, serializeRegistryDocument, StationRegistryStore } from '../src/registry.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function record(overrides: Partial<Parameters<typeof serializeRegistryDocument>[0][number]> = {}) {
  return {
    stationId: StationId('stn-1'),
    login: 'alice',
    name: 'ноутбук',
    rootPath: 'C:\\Работа',
    platform: 'win32' as const,
    tokenHash: 'aa'.repeat(32),
    createdAt: 100,
    lastSeenAt: 200,
    ...overrides,
  }
}

describe('parseRegistryDocument', () => {
  it('читает корректный документ и возвращает записи', () => {
    const doc = serializeRegistryDocument([record()])
    expect(parseRegistryDocument(doc, 'x.json')).toEqual([record()])
  })

  it('громко падает на каждой форме порчи', () => {
    expect(() => parseRegistryDocument('{oops', 'x.json')).toThrow(RegistryFileError)
    expect(() => parseRegistryDocument('null', 'x.json')).toThrow(/не является реестром/)
    expect(() => parseRegistryDocument(JSON.stringify({ version: 2, stations: [] }), 'x.json')).toThrow(/версия/)
    expect(() => parseRegistryDocument(JSON.stringify({ version: 1, stations: {} }), 'x.json')).toThrow(/массивом/)
    const broken = record() as unknown as Record<string, unknown>
    delete broken.tokenHash
    expect(() => parseRegistryDocument(JSON.stringify({ version: 1, stations: [broken] }), 'x.json')).toThrow(/tokenHash/)
    const badPlatform = record({ platform: 'win95' as never })
    expect(() => parseRegistryDocument(JSON.stringify({ version: 1, stations: [badPlatform] }), 'x.json')).toThrow(/платформу/)
    const duplicate = record()
    expect(() => parseRegistryDocument(JSON.stringify({ version: 1, stations: [duplicate, duplicate] }), 'x.json')).toThrow(/повторяет/)
  })
})

describe('StationRegistryStore', () => {
  it('отсутствующий файл — пустой реестр; добавление коммитит документ', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-stations-registry-'))
    const path = join(root, 'station-registry.json')
    const store = new StationRegistryStore({ filePath: path, now: () => 1000 })
    await store.load()
    expect(store.snapshot()).toEqual([])
    const added = await store.add({
      stationId: StationId('stn-9'),
      login: 'bob',
      name: 'мак',
      rootPath: '/Users/bob/work',
      platform: 'darwin',
      tokenHash: 'bb'.repeat(32),
    })
    expect(added.createdAt).toBe(1000)
    expect(added.lastSeenAt).toBe(1000)
    const onDisk = JSON.parse(await readFile(path, 'utf8')) as { version: number; stations: { stationId: string }[] }
    expect(onDisk.version).toBe(1)
    expect(onDisk.stations).toHaveLength(1)
    expect(onDisk.stations[0]?.stationId).toBe('stn-9')
  })

  it('touch обновляет lastSeenAt и откатывает память при сбое коммита', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-stations-registry-'))
    const path = join(root, 'station-registry.json')
    await writeFile(path, serializeRegistryDocument([record()]))
    let clock = 5000
    const store = new StationRegistryStore({ filePath: path, now: () => clock })
    await store.load()
    clock = 6000
    const touched = await store.touch('stn-1')
    expect(touched.lastSeenAt).toBe(6000)
    const reread = new StationRegistryStore({ filePath: path })
    await reread.load()
    expect(reread.get('stn-1')?.lastSeenAt).toBe(6000)

    // Сбой коммита: документ на диске портим, запись должна упасть и
    // откатить память к прежнему значению.
    await writeFile(path, 'не документ')
    await expect(store.touch('stn-1')).rejects.toThrow(RegistryFileError)
    expect(store.get('stn-1')?.lastSeenAt).toBe(6000)
  })

  it('чужой документ при коммите не затирается: слияние по stationId', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-stations-registry-'))
    const path = join(root, 'station-registry.json')
    const store = new StationRegistryStore({ filePath: path, now: () => 10 })
    await store.load()
    await store.add({
      stationId: StationId('stn-mine'),
      login: 'alice',
      name: 'моя',
      rootPath: '/w',
      platform: 'linux',
      tokenHash: 'cc'.repeat(32),
    })
    // Второй процесс добавил свою станцию между нашими операциями.
    const foreign = record({ stationId: StationId("stn-foreign"), name: "чужая" })
    await writeFile(path, serializeRegistryDocument([foreign]))
    await store.touch('stn-mine')
    const merged = parseRegistryDocument(await readFile(path, 'utf8'), path)
    expect(merged.map(item => String(item.stationId)).sort()).toEqual(['stn-foreign', 'stn-mine'])
  })
})
