/**
 * Доказательство машрутизации провайдеров: fs-station и subprocess-station,
 * смонтированные в одном контексте с настоящим хостом и коннектором,
 * исполняют операции швов на станции. Это юнит-доказательство 5a; полную
 * сессионную привязку (preset/isolate) делает 5b.
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
import { StationExecutor } from '@deepseek-ai/dsh-station-connector'
import { runConnectorLoop } from '@deepseek-ai/dsh-station-connector'
import StationFileSystem from '@deepseek-ai/dsh-fs-station'
import StationSubprocessRuntime from '@deepseek-ai/dsh-subprocess-station'

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

/** Поднимает хост с обоими провайдерами над одной станцией и возвращает контекст. */
async function boot(): Promise<{ stationId: StationId; stop: () => Promise<void> }> {
  const ctx = new Context()
  await ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 })
  const home = await mkdtemp(join(tmpdir(), 'dsh-prov-host-'))
  roots.push(home)
  await ctx.plugin(StationsService, { registryPath: join(home, 'station-registry.json') })
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-prov-work-'))
  roots.push(workspace)
  context = ctx
  const { code } = ctx.stations.beginPairing('provider-spec')
  const url = `ws://127.0.0.1:${String(ctx.webServer.port)}/station-ws`

  // Сопряжение отдельным соединением (как CLI pair).
  const welcome = await new Promise<{ stationId?: string; token?: string }>((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', version: 1, auth: { mode: 'pair', code, stationName: 'провайдеры', rootPath: workspace, platform } }))
    })
    ws.on('message', (data: Buffer) => {
      const frame = JSON.parse(String(data)) as { t?: string; stationId?: string; token?: string; message?: string }
      if (frame.t === 'welcome') { resolve(frame); ws.close() }
      else { reject(new Error(String(frame.message))); ws.close() }
    })
    ws.on('error', (error) => { reject(error) })
  })
  const stationId = StationId(welcome.stationId as string)
  const token = welcome.token as string

  // Провайдеры поверх моста: обе строки, которые 5b будет вешать на сессию.
  await ctx.plugin(StationFileSystem, { stationId: String(stationId) })
  await ctx.plugin(StationSubprocessRuntime, { stationId: String(stationId) })

  // Рабочий цикл коннектора по токену.
  let socket: WebSocket | undefined
  const executor = new StationExecutor(workspace, platform, (event) => {
    socket?.send(JSON.stringify(event))
  })
  const signal = new AbortController()
  const loop = runConnectorLoop({
    url,
    auth: (): StationHelloAuth => ({ mode: 'token', token }),
    executor,
    reconnect: true,
    signal: signal.signal,
    socketHook: (ws) => { socket = ws },
  })
  const stop = async (): Promise<void> => {
    signal.abort()
    await loop.catch(() => {})
    await executor.dispose()
  }
  return { stationId, stop }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

describe('машрутизация провайдеров над мостом', () => {
  it('ctx.fs пишет и читает на станции; ctx.subprocess исполняет процесс', { timeout: 30_000 }, async () => {
    const { stationId, stop } = await boot()
    try {
      // Ждём рабочий мост, а не флаг: сессия сопряжения гаснет асинхронно,
      // поэтому живость проверяем дешёвой операцией.
      const deadline = Date.now() + 10_000
      let ready = false
      while (!ready && Date.now() < deadline) {
        try {
          if (context!.stations.isOnline(stationId)) {
            await context!.stations.bridge(stationId).request('proc/list', {})
            ready = true
          } else { await wait(50) }
        } catch { await wait(50) }
      }
      expect(ready).toBe(true)

      // Шов fs: resolve → writeText → readText → listDir по файловой системе
      // СТАНЦИИ, а не хоста: хостовый tmp-каталог хоста остаётся пустым.
      const fs = context!.fs
      const target = await fs.resolve('заметки/через-шов.txt')
      const written = await fs.writeText(target, 'через шов fs')
      expect(written.operation).toBe('create')
      const content = await fs.readText(target)
      expect(content).toBe('через шов fs')
      const dir = await fs.resolve('заметки')
      const entries = await fs.listDir(dir)
      expect(entries.map(entry => entry.name)).toEqual(['через-шов.txt'])

      // Шов subprocess: spawn через мост, collect через окна.
      const subprocess = context!.subprocess
      const resolved = await subprocess.resolveExecutable(process.execPath)
      expect(resolved).toBe(process.execPath)
      const handle = subprocess.spawn({
        argv: [process.execPath, '-e', 'process.stdout.write("готово")'],
        cwd: String((await fs.resolve('.')).targetKey),
        stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
        graceMs: 5_000,
      })
      const outcome = await handle.done
      expect(outcome.exitCode).toBe(0)
      const collected = handle.collected.stdout!.readFrom(0)
      expect(collected.text).toBe('готово')
      expect(collected.lossy).toBe(false)
    } finally {
      await stop()
    }
  })
})
