/** Юнит-тесты конфига: чтение, строгий разбор, запись. */

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readConfig, stationHome, writeConfig } from '../src/config.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('stationHome', () => {
  it('уважает DSH_STATION_HOME и по умолчанию идёт в домашнюю папку', () => {
    expect(stationHome({ DSH_STATION_HOME: 'C:/переносная' })).toBe('C:/переносная')
    expect(stationHome({ DSH_STATION_HOME: '   ' })).toMatch(/[\\/]\.dsh-station$/)
    expect(stationHome({})).toMatch(/[\\/]\.dsh-station$/)
  })
})

describe('readConfig/writeConfig', () => {
  it('отсутствующий файл — undefined; корректный документ читается обратно', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-connector-config-'))
    expect(await readConfig(root)).toBeUndefined()
    await writeConfig(root, {
      server: 'wss://cloud.example.com/station-ws',
      stationId: 'stn-1',
      token: 'секрет',
      name: 'ноутбук',
      root: 'C:\\Работа',
    })
    const config = await readConfig(root)
    expect(config?.token).toBe('секрет')
    const text = await readFile(join(root, 'config.json'), 'utf8')
    expect(text.endsWith("\n")).toBe(true)
  })

  it('битый и чужой документы падают громко', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-connector-config-'))
    await writeFile(join(root, 'config.json'), '{oops')
    await expect(readConfig(root)).rejects.toThrow(/не является JSON/)
    await writeFile(join(root, 'config.json'), JSON.stringify({ url: 'x' }))
    await expect(readConfig(root)).rejects.toThrow(/формату config\.json/)
  })

  it('writeConfig создаёт домашнюю папку при необходимости', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-connector-config-'))
    const home = join(root, 'вложенная', 'папка')
    await writeConfig(home, { server: "ws://x/station-ws" })
    expect((await readConfig(home))?.server).toBe('ws://x/station-ws')
  })
})
