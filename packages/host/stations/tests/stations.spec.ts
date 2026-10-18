/**
 * Юнит-тесты сервиса станций и серверной сессии протокола: выдача и
 * гашение одноразовых кодов, TTL, привязка к логину, timing-safe
 * проверка токена, сессия на подменённом сокете — приветствие обоими
 * способами, корреляция запрос/ответ, события и замена сессии.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { StationsError, StationsService, StationOpRemoteError } from '../src/index.ts'
import type { StationFrame } from '@deepseek-ai/dsh-station-protocol'
import { StationServerSession, StationBridgeClosedError } from '../src/session.ts'
import type { StationSessionHost } from '../src/session.ts'
import { StationId, type StationEventFrame } from '@deepseek-ai/dsh-station-protocol'

/** Подменённый сокет: копит отправленное, играет по тесту. */
class FakeSocket {
  out: string[] = []
  closed = false
  closeCode: number | undefined
  send(data: string): void {
    this.out.push(data)
  }

  close(code?: number): void {
    this.closed = true
    this.closeCode = code
  }
}

/** Службы хоста для сессии, ведущие себя по сценарию теста. */
function fakeHost(overrides: Partial<StationSessionHost> = {}): StationSessionHost & { online: string[] } {
  const state: { online: string[] } = { online: [] }
  return {
    online: state.online,
    completePairing: async (): Promise<{ stationId: StationId; token: string; rootPath: string }> => {
      return { stationId: StationId('stn-1'), token: 'tok', rootPath: '/w' }
    },
    verifyStationToken: (token: string): { stationId: StationId; rootPath: string; platform: 'win32' | 'darwin' | 'linux' } | undefined =>
      token === 'хороший' ? { stationId: StationId('stn-2'), rootPath: '/w2', platform: 'linux' } : undefined,
    markOnline: (stationId: StationId) => {
      state.online.push(String(stationId))
    },
    markOffline: (stationId: StationId) => {
      state.online = state.online.filter(id => id !== String(stationId))
    },
    logError: () => {},
    ...overrides,
  }
}

async function makeService(pairingCodeTtlMs?: number): Promise<{ service: StationsService; ctx: Context; root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-stations-service-'))
  const path = join(root, 'station-registry.json')
  const ctx = new Context()
  const upgrades: unknown[] = []
  ctx.provide('webServer', {
    registerUpgrade: (route: unknown) => {
      upgrades.push(route)
      return () => {}
    },
  } as never)
  const service = new StationsService(ctx, {
    registryPath: path,
    ...(pairingCodeTtlMs === undefined ? {} : { pairingCodeTtlMs }),
  })
  // Service.init защищённый: у класса он объявлен как protected-символ.
  const init = (service as unknown as { [Service.init]: () => Promise<void> })[Service.init]
  await init.call(service)
  expect(upgrades).toHaveLength(1)
  return { service, ctx, root, path }
}

describe('сопряжение', () => {
  it('выдаёт одноразовый код, гасит его и пишет запись в реестр', async () => {
    const { service, root, path } = await makeService()
    const { code, wssPath } = service.beginPairing('alice')
    expect(wssPath).toBe('/station-ws')
    expect(code).toMatch(/^[23456789bcdghjkmnpqrstvwxz]{8}$/)
    const done = await service.completePairing(code, 'ноутбук', 'C:\\Работа', 'win32')
    expect(String(done.stationId)).toMatch(/^stn-/)
    expect(done.token).toMatch(/^[0-9a-f]{64}$/)
    // Повторное использование того же кода гасится.
    await expect(service.completePairing(code, 'второй', 'C:\\x', 'win32')).rejects.toMatchObject({ code: 'bad-code' })
    const doc = JSON.parse(await readFile(path, 'utf8')) as { stations: { login: string; name: string }[] }
    expect(doc.stations[0]?.login).toBe('alice')
    expect(doc.stations[0]?.name).toBe('ноутбук')
    // Токен из сопряжения принимается по хранящемуся хэшу.
    expect(service.verifyStationToken(done.token)?.stationId).toBe(done.stationId)
    expect(service.verifyStationToken('не токен')).toBeUndefined()
    const listed = await service.list('alice')
    expect(listed[0]?.name).toBe('ноутбук')
    expect(listed[0]?.online).toBe(false)
    await rm(root, { recursive: true, force: true })
  })

  it('код с истёкшим TTL не принимается; имя и корень проверяются', async () => {
    const { service } = await makeService(5)
    const { code } = service.beginPairing('bob')
    await new Promise(resolve => setTimeout(resolve, 15))
    await expect(service.completePairing(code, 'станция', '/w', 'linux')).rejects.toMatchObject({ code: 'bad-code' })
    const fresh = service.beginPairing('bob')
    await expect(service.completePairing(fresh.code, '', '/w', 'linux')).rejects.toMatchObject({ code: 'bad-input' })
    await expect(service.completePairing(fresh.code, 'станция', 'относительный/путь', 'linux')).rejects.toMatchObject({ code: 'bad-input' })
    // beginPairing бросает синхронно, поэтому проверяем через функцию.
    expect(() => service.beginPairing('  ')).toThrow(StationsError)
  })

  it('bridge различает несопряжённую и офлайн станции', async () => {
    const { service } = await makeService()
    expect(() => service.bridge('stn-none' as StationId)).toThrow(/не сопряжена/)
  })
})

describe('StationServerSession', () => {
  /** Прогоняет микрозадачи: async-приветствие успевает отправить кадр. */
  const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
  it('приветствие сопряжением отправляет welcome с токеном и выходит онлайн', async () => {
    const socket = new FakeSocket()
    const host = fakeHost()
    const session = new StationServerSession(socket, host)
    session.handleMessage(JSON.stringify({ t: 'hello', version: 1, auth: { mode: 'pair', code: 'abcd2345', stationName: 'ноут', rootPath: '/w', platform: 'linux' } }))
    await flush()
    const frames = socket.out.map(line => JSON.parse(line) as StationFrame)
    expect(frames[0]).toMatchObject({ t: 'welcome', stationId: 'stn-1', rootPath: '/w', token: 'tok' })
    expect(session.stationId).toBe('stn-1')
    expect(host.online).toEqual(['stn-1'])
  })

  it('приветствие токеном отклоняет неверный токен и закрывает сокет', async () => {
    const socket = new FakeSocket()
    const session = new StationServerSession(socket, fakeHost())
    session.handleMessage(JSON.stringify({ t: 'hello', version: 1, auth: { mode: 'token', token: 'плохой' } }))
    await flush()
    expect(socket.out.map(line => JSON.parse(line) as StationFrame)[0]).toMatchObject({ t: 'reject', reason: 'bad-token' })
    expect(socket.closed).toBe(true)
  })

  it('запрос коррелируется по id, отказ операции приезжает типизированной ошибкой', async () => {
    const socket = new FakeSocket()
    const session = new StationServerSession(socket, fakeHost())
    session.handleMessage(JSON.stringify({ t: 'hello', version: 1, auth: { mode: 'token', token: 'хороший' } }))
    await flush()
    const done = session.request('fs/stat', { path: '/w/файл' })
    const reqFrame = JSON.parse(socket.out.at(-1) as string) as { t: string; id: string; op: string; p: unknown }
    expect(reqFrame.t).toBe('req')
    expect(reqFrame.op).toBe('fs/stat')
    session.handleMessage(JSON.stringify({ t: 'res', id: reqFrame.id, ok: false, error: { code: 'denied', message: 'вне корня' } }))
    await expect(done).rejects.toThrow(StationOpRemoteError)
  })

  it('успешный ответ возвращает значение, закрытие сокета отклоняет ожидающих', async () => {
    const socket = new FakeSocket()
    const session = new StationServerSession(socket, fakeHost())
    session.handleMessage(JSON.stringify({ t: 'hello', version: 1, auth: { mode: 'token', token: 'хороший' } }))
    await flush()
    const done = session.request('proc/list', {})
    const reqFrame = JSON.parse(socket.out.at(-1) as string) as { id: string }
    session.handleMessage(JSON.stringify({ t: 'res', id: reqFrame.id, ok: true, value: { processes: [] } }))
    await expect(done).resolves.toEqual({ processes: [] })

    const pending = session.request('fs/list', { path: '/w' })
    session.handleClose()
    await expect(pending).rejects.toThrow(StationBridgeClosedError)
    await expect(session.request('fs/list', { path: '/w' })).rejects.toThrow(StationBridgeClosedError)
  })

  it('события доходят подписчикам; диспозер отписывает', async () => {
    const socket = new FakeSocket()
    const session = new StationServerSession(socket, fakeHost())
    session.handleMessage(JSON.stringify({ t: 'hello', version: 1, auth: { mode: 'token', token: 'хороший' } }))
    await flush()
    const events: StationEventFrame[] = []
    const dispose = session.onEvent((event) => { events.push(event) })
    session.handleMessage(JSON.stringify({ t: 'evt', event: 'proc/stdout', p: { id: 'p1', data: 'aGk=' } }))
    expect(events).toHaveLength(1)
    dispose()
    session.handleMessage(JSON.stringify({ t: 'evt', event: 'proc/stdout', p: { id: 'p1', data: 'eW8=' } }))
    expect(events).toHaveLength(1)
  })
})

describe('событие station/status и get()', () => {
  /** Прогоняет микрозадачи: async-приветствие успевает отправить кадр. */
  const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

  /** Приватный sessionHost сервиса: тесту нужен тот же экземпляр, что и attach(). */
  function hostOf(service: StationsService): StationSessionHost {
    return (service as unknown as { sessionHost(): StationSessionHost }).sessionHost()
  }

  it('поднимается на выходе онлайн и уходе в офлайн; замена соединения статус не меняет', async () => {
    const { service, ctx, root } = await makeService()
    const events: { stationId: string; online: boolean }[] = []
    ctx.on('station/status', (payload) => {
      events.push({ stationId: String(payload.stationId), online: payload.online })
    })
    const { code } = service.beginPairing('alice')
    const { stationId, token } = await service.completePairing(code, 'ноутбук', '/w', 'linux')
    const host = hostOf(service)
    const first = new StationServerSession(new FakeSocket(), host)
    first.handleMessage(JSON.stringify({ t: 'hello', version: 1, auth: { mode: 'token', token } }))
    await flush()
    expect(events).toEqual([{ stationId: String(stationId), online: true }])
    expect(service.isOnline(stationId)).toBe(true)
    // Замена живого соединения свежим: статус «онлайн» не меняется, офлайн-события нет.
    const second = new StationServerSession(new FakeSocket(), host)
    second.handleMessage(JSON.stringify({ t: 'hello', version: 1, auth: { mode: 'token', token } }))
    await flush()
    expect(events).toHaveLength(1)
    expect(service.isOnline(stationId)).toBe(true)
    // Живая сессия закрылась — единственное событие офлайн.
    second.handleClose()
    expect(events).toEqual([
      { stationId: String(stationId), online: true },
      { stationId: String(stationId), online: false },
    ])
    expect(service.isOnline(stationId)).toBe(false)
    await rm(root, { recursive: true, force: true })
  })

  it('get() возвращает вид станции без секретов и undefined для несопряжённой', async () => {
    const { service, root } = await makeService()
    expect(await service.get(StationId('stn-none'))).toBeUndefined()
    const { code } = service.beginPairing('alice')
    const { stationId } = await service.completePairing(code, 'ноутбук', '/w', 'linux')
    const view = await service.get(stationId)
    expect(view).toMatchObject({ stationId: String(stationId), login: 'alice', name: 'ноутбук', online: false })
    expect(view).not.toHaveProperty('tokenHash')
    await rm(root, { recursive: true, force: true })
  })
})
