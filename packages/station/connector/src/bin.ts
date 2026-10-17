/**
 * Точка входа `dsh-station`: парсит argv и передаёт управление командой.
 * @module @deepseek-ai/dsh-station-connector/bin
 */

import { buildProgram } from './cli.ts'

void buildProgram().parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
