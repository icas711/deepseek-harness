/**
 * CLI коннектора станции: `pair` — сопряжение с оркестратором, `run` —
 * рабочий цикл с переподключением. Сообщения пользователю — только
 * на русском; токен станции сохраняется в config.json с правами 0600.
 * @module @deepseek-ai/dsh-station-connector/cli
 */

import { stat, realpath } from 'node:fs/promises'
import process from 'node:process'
import { Command } from 'commander'
import { STATION_PROTOCOL_VERSION } from '@deepseek-ai/dsh-station-protocol'
import type { StationHelloAuth, StationPlatform } from '@deepseek-ai/dsh-station-protocol'
import WebSocket from 'ws'
import { readConfig, stationHome, writeConfig } from './config.ts'
import type { StationConnectorConfig } from './config.ts'
import { StationExecutor } from './executor.ts'
import { runConnectorLoop, StationRejectedError } from './session.ts'

/** Платформа текущего процесса в словаре протокола. */
function currentPlatform(): StationPlatform {
  return process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
}

/**
 * Собирает программу CLI. Разделение buildProgram и главной функции
 * позволяет тестам строить программу без системного выхода.
 * @returns готовый Command с командами pair и run.
 */
export function buildProgram(): Command {
  const program = new Command()
  program.name('dsh-station').description('Коннектор станции DSH: исполнение задач на этой машине по мосту к оркестратору')

  program.command('pair')
    .description('Сопрячь эту машину с оркестратором по одноразовому коду')
    .requiredOption('--server <url>', 'базовый URL хоста, например https://cloud.example.com')
    .requiredOption('--code <code>', 'одноразовый код сопряжения из station.beginPairing')
    .option('--name <name>', 'показательное имя станции', 'моя станция')
    .option('--root <path>', 'корневая папка мира исполнения (по умолчанию — текущая)')
    .option('--home <path>', 'домашняя папка коннектора (по умолчанию ~/.dsh-station)')
    .action(async options => {
      const home = options.home ?? stationHome()
      const root = options.root ?? process.cwd()
      const exit = await runPair(home, options.server, options.code, options.name, root)
      if (exit !== 0) process.exitCode = exit
    })

  program.command('run')
    .description('Подключи станцию к оркестратору и обслуживай операции (после сопряжения)')
    .option('--server <url>', 'переопределить URL хоста из конфига')
    .option('--home <path>', 'домашняя папка коннектора (по умолчанию ~/.dsh-station)')
    .action(async options => {
      const home = options.home ?? stationHome()
      const exit = await runServe(home, options.server)
      if (exit !== 0) process.exitCode = exit
    })

  return program
}

/**
 * Сопряжение: подключается с кодом, сохраняет токен и корень в конфиг.
 * @param home - домашняя папка коннектора.
 * @param serverBase - базовый URL хоста (http/https или ws/wss).
 * @param code - одноразовый код.
 * @param name - имя станции.
 * @param root - корневая папка.
 * @returns код выхода процесса.
 */
export async function runPair(
  home: string,
  serverBase: string,
  code: string,
  name: string,
  root: string,
): Promise<number> {
  try {
    const rootInfo = await stat(root)
    if (!rootInfo.isDirectory()) {
      console.error(`Ошибка: «${root}» не является папкой.`)
      return 2
    }
    const canonicalRoot = await realpath(root)
    const url = stationUrl(serverBase)
    const platform = currentPlatform()
    console.log(`Сопряжение с ${url}…`)
    const welcome = await pairOnce(url, {
      mode: 'pair',
      code,
      stationName: name,
      rootPath: canonicalRoot,
      platform,
    })
    const config: StationConnectorConfig = {
      server: url,
      stationId: welcome.stationId,
      token: welcome.token,
      name,
      root: canonicalRoot,
    }
    await writeConfig(home, config)
    console.log('Станция сопряжена. Токен сохранён в config.json (права 0600; на Windows права файлов не действуют).')
    console.log(`Корень мира исполнения: ${canonicalRoot}`)
    console.log('Запустите: dsh-station run')
    return 0
  } catch (error) {
    console.error(`Сопряжение не удалось: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

/**
 * Рабочий цикл: конфиг обязателен, соединение держится до Ctrl+C,
 * разрывы лечатся переподключением с бэкоффом.
 * @param home - домашняя папка коннектора.
 * @param serverOverride - переопределение URL из конфига.
 * @returns код выхода процесса.
 */
export async function runServe(home: string, serverOverride?: string): Promise<number> {
  let config: StationConnectorConfig | undefined
  try {
    config = await readConfig(home)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }
  if (config === undefined) {
    console.error('Ошибка: станция ещё не сопряжена. Выполните: dsh-station pair --server <url> --code <code>')
    return 2
  }
  if (config.token === undefined || config.root === undefined) {
    console.error('Ошибка: в конфиге нет токена или корня — повторите сопряжение.')
    return 2
  }
  const url = serverOverride === undefined ? config.server : stationUrl(serverOverride)
  const controller = new AbortController()
  const onSignal = (): void => {
    console.log('Остановка: завершаю процессы станции…')
    controller.abort()
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  // События исполнителя (stdout/stderr/exit) едут в активный сокет.
  let socket: WebSocket | undefined
  const executor = new StationExecutor(config.root, currentPlatform(), event => {
    socket?.send(JSON.stringify(event))
  })
  try {
    console.log(`Подключение к ${url}; корень: ${config.root}`)
    await runConnectorLoop({
      url,
      auth: () => ({
        mode: 'token',
        token: config!.token!,
      }),
      executor,
      reconnect: true,
      signal: controller.signal,
      onState: (state, detail) => {
        if (state === 'online') console.log('Станция на связи.')
        if (state === 'waiting') console.log(`Соединение потеряно (${detail ?? 'нет деталей'}); переподключаюсь…`)
        if (state === 'stopped' && detail !== undefined) console.log(`Остановлено: ${detail}`)
      },
      socketHook: ws => {
        socket = ws
      },
    })
    return 0
  } catch (error) {
    if (error instanceof StationRejectedError) {
      console.error(`Хост отказал: ${error.message}`)
      if (error.reason === 'bad-token') console.error('Токен недействителен — запросите новое сопряжение (station.beginPairing) и выполните pair заново.')
    } else {
      console.error(`Ошибка коннектора: ${error instanceof Error ? error.message : String(error)}`)
    }
    return 1
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    await executor.dispose()
  }
}

/**
 * Превращает базовый URL хоста в URL WSS-маршрута станции.
 * @param base - http(s) или ws(s) URL.
 * @returns полный URL маршрута /station-ws.
 * @throws Error, когда база не похожа на URL.
 */
export function stationUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (/^wss?:\/\//.test(trimmed)) {
    return trimmed.endsWith("/station-ws") ? trimmed : `${trimmed}/station-ws`
  }
  if (/^https?:\/\//.test(trimmed)) {
    return `${trimmed.replace(/^http/, 'ws')}/station-ws`
  }
  throw new Error(`--server обязан быть URL http(s) или ws(s), получено: ${base}`)
}

async function pairOnce(url: string, auth: StationHelloAuth): Promise<{ stationId: string; token: string; rootPath: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', version: STATION_PROTOCOL_VERSION, auth }))
    })
    ws.on('message', data => {
      try {
        const frame = JSON.parse(String(data)) as { t?: string; stationId?: string; token?: string; rootPath?: string; reason?: string; message?: string }
        if (frame.t === 'welcome') {
          if (frame.token === undefined || frame.stationId === undefined) {
            reject(new Error('хост не вернул токен или идентификатор сопряжения'))
            ws.close()
            return
          }
          resolve({ stationId: frame.stationId, token: frame.token, rootPath: frame.rootPath ?? "" })
          ws.close()
          return
        }
        if (frame.t === 'reject') {
          reject(new StationRejectedError(frame.reason ?? 'bad-request', frame.message ?? 'хост отклонил сопряжение'))
          ws.close()
          return
        }
        reject(new Error(`неожиданный кадр при сопряжении: ${String(frame.t)}`))
        ws.close()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        ws.close()
      }
    })
    ws.on('error', error => {
      reject(error)
    })
  })
}
