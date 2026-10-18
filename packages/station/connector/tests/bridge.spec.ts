/**
 * Интеграционный тест моста в одном процессе: настоящий веб-сервер хоста,
 * настоящий WebSocket и настоящий коннектор с исполнителем. Сопряжение →
 * fs-операция → spawn → результат, замена токена и offline-поведение
 * (разрыв, переподключение с бэкоффом, восстановление моста).
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import { StationsService } from '@deepseek-ai/dsh-stations'
import { StationId, type StationHelloAuth } from '@deepseek-ai/dsh-station-protocol'
import WebSocket from 'ws'
import { StationExecutor } from '../src/executor.ts'
import { runConnectorLoop } from '../src/session.ts'

const roots: string[] = []
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  while (roots.length > 0) {
    await rm(roots.pop() as string, { recursive: true, force: true })
  }
})

const platform = process.platform === 'win32' ? 'win32' as const : 'linux' as const
const sep = platform === 'win32' ? '\\' : '/'

interface HostBoot { stations: StationsService; port: number }

/** Поднимает хост: настоящий веб-сервер на порту 0 плюс сервис станций. */
async function bootHost(): Promise<HostBoot> {
  const ctx = new Context()
  await ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 })
  const home = await mkdtemp(join(tmpdir(), 'dsh-bridge-host-'))
  roots.push(home)
  await ctx.plugin(StationsService, { registryPath: join(home, 'station-registry.json') })
  context = ctx
  return { stations: ctx.stations, port: ctx.webServer.port }
}

/** Клиентский цикл коннектора над tmp-корнем с управлением и обрывом. */
async function connector(url: string, rootPath: string, auth: () => StationHelloAuth) {
  const events: Array<Record<string, unknown>> = []
  let socket: WebSocket | undefined
  const executor = new StationExecutor(rootPath, platform, (event) => {
    events.push(event)
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event))
  })
  const signal = new AbortController()
  const done = runConnectorLoop({
    url,
    auth,
    executor,
    reconnect: true,
    signal: signal.signal,
    socketHook: (ws) => { socket = ws },
  })
  return {
    events,
    forceDrop: (): void => { socket?.terminate() },
    stop: async (): Promise<void> => {
      signal.abort()
      await done.catch(() => {})
      await executor.dispose()
    },
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

async function waitFor<T>(probe: () => T | undefined, label: string): Promise<T> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const value = probe()
    if (value !== undefined) return value
    await wait(25)
  }
  throw new Error(`не дождались: ${label}`)
}

describe('мост станций: сквозной поток', () => {
  it('сопряжение → fs → spawn → результат, затем разрыв и переподключение по токену', async () => {
    const host = await bootHost()
    const { code } = host.stations.beginPairing('carol')
    const url = `ws://127.0.0.1:${String(host.port)}/station-ws`

    // Сопряжение отдельным одноразовым соединением — как CLI pair.
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-bridge-work-'))
    roots.push(workspace)
    const welcome = await pairAndGetWelcome(url, {
      mode: 'pair', code, stationName: 'тест-станция', rootPath: workspace, platform,
    })
    expect(welcome.token).toBeDefined()
    expect(String(welcome.stationId)).toMatch(/^stn-/)
    expect(welcome.rootPath).toBe(workspace)
    const listed = await host.stations.list('carol')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.name).toBe('тест-станция')

    // Рабочий цикл коннектора по токену (как CLI run).
    const token = welcome.token as string
    const stationId = StationId(welcome.stationId as string)
    const client = await connector(url, workspace, () => ({ mode: 'token', token }))
    try {
      await wait(300)
      expect(host.stations.isOnline(stationId)).toBe(true)
      const bridge = host.stations.bridge(stationId)

      // fs-операция через мост: запись и чтение внутри корня.
      const content = Buffer.from('мост работает').toString('base64')
      await bridge.request('fs/write', { path: 'заметки/файл.txt', data: content, createOnly: true })
      const readBack = await bridge.request('fs/read', { path: 'заметки/файл.txt', maxBytes: 1000 })
      expect(readBack.data).toBe(content)

      // Выход за корень: коннектор отвечает typed denied.
      await expect(bridge.request('fs/stat', { path: platform === 'win32' ? `C:${sep}чужое` : '/etc/passwd' }))
        .rejects.toMatchObject({ code: 'denied' })

      // spawn через мост: stdout событием на коннекторе, затем exit 0.
      const stdoutPromise = waitFor(() => {
        const found = client.events.find(event => event.event === 'proc/stdout') as { p?: { data?: string } } | undefined
        return found?.p?.data
      }, 'stdout-событие на коннекторе')
      const spawned = await bridge.request('proc/spawn', {
        id: 'привет',
        argv: [process.execPath, '-e', 'console.log("привет")'],
        cwd: workspace,
        stdin: { mode: 'ignore' },
        stdoutInherit: false,
        stderrInherit: false,
      })
      expect(spawned.pid).toBeGreaterThan(0)
      const stdoutData = await stdoutPromise
      expect(Buffer.from(stdoutData, 'base64').toString()).toContain('привет')
      const exitCode = await waitFor(() => {
        const found = client.events.find(event => event.event === 'proc/exit') as { p?: { exitCode?: number } } | undefined
        return found?.p?.exitCode
      }, 'proc/exit')
      expect(exitCode).toBe(0)

      // Offline: разрыв — мост гаснет; коннектор с бэкоффом возвращается сам.
      client.forceDrop()
      await waitFor(() => host.stations.isOnline(stationId) ? undefined : true, 'офлайн после разрыва')
      expect(() => host.stations.bridge(stationId)).toThrow(/офлайн/)
      await waitFor(() => host.stations.isOnline(stationId) ? true : undefined, 'возврат онлайн')
      const revived = host.stations.bridge(stationId)
      const stat = await revived.request('fs/stat', { path: 'заметки/файл.txt' })
      expect(stat).toMatchObject({ exists: true, type: 'file' })
    } finally {
      await client.stop()
    }
  }, 30_000)

  it('повторное использование кода сопряжения отклоняется; чужой токен не проходит', async () => {
    const host = await bootHost()
    const { code } = host.stations.beginPairing('bob')
    const url = `ws://127.0.0.1:${String(host.port)}/station-ws`
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-bridge-work2-'))
    roots.push(workspace)
    const first = await pairAndGetWelcome(url, {
      mode: 'pair', code, stationName: 'вторая', rootPath: workspace, platform,
    })
    // Тот же код второй раз — reject bad-code.
    await expect(pairAndGetWelcome(url, {
      mode: 'pair', code, stationName: 'повтор', rootPath: workspace, platform,
    })).rejects.toThrow(/код сопряжения/)
    // Чужой токен — reject bad-token.
    await expect(pairAndGetWelcome(url, { mode: 'token', token: 'не-токен' })).rejects.toThrow(/токен/)
    expect(first.token).toBeDefined()
  }, 30_000)
})

async function pairAndGetWelcome(url: string, auth: StationHelloAuth): Promise<{ stationId?: string; token?: string; rootPath?: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', version: 1, auth }))
    })
    ws.on('message', (data: Buffer) => {
      try {
        const frame = JSON.parse(String(data)) as {
          t?: string
          stationId?: string
          token?: string
          rootPath?: string
          reason?: string
          message?: string
        }
        if (frame.t === 'welcome') {
          resolve(frame)
          ws.close()
          return
        }
        if (frame.t === 'reject') {
          reject(new Error(`отказ ${String(frame.reason)}: ${String(frame.message)}`))
          ws.close()
          return
        }
        reject(new Error(`неожиданный кадр ${String(frame.t)}`))
        ws.close()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        ws.close()
      }
    })
    ws.on('error', (error) => { reject(error) })
  })
}
