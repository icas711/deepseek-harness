/**
 * Конфиг коннектора: домашняя папка коннектора, документ config.json
 * и строгий разбор на границе носителя. Токен станции — секрет
 * машины пользователя: файл пишется с правами 0600 (на Windows права
 * не действуют, документ это фиксирует), папка — 0700.
 * @module @deepseek-ai/dsh-station-connector/config
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Документ config.json коннектора. */
export interface StationConnectorConfig {
  /** Полный URL WSS-маршрута хоста, например wss://cloud.example.com/station-ws. */
  server: string
  /** Идентификатор станции из сопряжения. */
  stationId?: string
  /** Токен станции; выдаётся ровно один раз при сопряжении. */
  token?: string
  /** Показательное имя станции. */
  name?: string
  /** Корневая папка: единственный мир исполнения моста. */
  root?: string
}

/**
 * Домашняя папка коннектора.
 * @param env - окружение; `$DSH_STATION_HOME` переносит папку (тесты, переносимая установка).
 * @returns абсолютный путь домашней папки.
 */
export function stationHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.DSH_STATION_HOME
  return override !== undefined && override.trim().length > 0 ? override : join(homedir(), '.dsh-station')
}

function isConfig(value: unknown): value is StationConnectorConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record.server !== 'string' || record.server.length === 0) return false
  for (const field of ['stationId', 'token', 'name', 'root'] as const) {
    if (record[field] !== undefined && typeof record[field] !== 'string') return false
  }
  return true
}

/**
 * Читает конфиг; отсутствие файла — ещё не сопряжённая машина.
 * @param home - домашняя папка коннектора.
 * @returns конфиг или undefined.
 * @throws Error, когда файл существует и не разбирается — порча громко падает.
 */
export async function readConfig(home: string): Promise<StationConnectorConfig | undefined> {
  const path = join(home, 'config.json')
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`station-connector: конфиг "${path}" не является JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  if (!isConfig(parsed)) {
    throw new Error(`station-connector: конфиг "${path}" не соответствует формату config.json коннектора`)
  }
  return parsed
}

/**
 * Пишет конфиг атомарно с правами 0600 (папке — 0700). На Windows
 * POSIX-права не действуют: документ предупреждает об этом пользователя.
 * @param home - домашняя папка коннектора.
 * @param config - полный следующий документ.
 */
export async function writeConfig(home: string, config: StationConnectorConfig): Promise<void> {
  await writeFileAtomic(join(home, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}
