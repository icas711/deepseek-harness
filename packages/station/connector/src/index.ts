/**
 * Коннектор станции: программная грань для тестов и встраивания.
 * CLI-команды живут в `./cli.ts`, вход — `./bin.ts`.
 * @module @deepseek-ai/dsh-station-connector
 */

export { readConfig, stationHome, writeConfig } from './config.ts'
export type { StationConnectorConfig } from './config.ts'
export { nextBackoffMs, RECONNECT_INITIAL_MS, RECONNECT_MAX_MS } from './backoff.ts'
export { StationExecutor } from './executor.ts'
export { runConnectorLoop, StationRejectedError } from './session.ts'
export type { ConnectorLoopOptions, ConnectorState } from './session.ts'
export { buildProgram, runPair, runServe, stationUrl } from './cli.ts'
