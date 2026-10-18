/**
 * Провайдер процессов над мостом станций: тот же шов ctx.subprocess, что и
 * локальный бэкенд. Деревья и stdio живут на станции; сбор вывода,
 * offset-чтение и эскалация terminate — на хосте. Терминальные сессии
 * (PTY) через мост — этап 5b.
 * @module @deepseek-ai/dsh-subprocess-station
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { scrubbedParentEnv, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { StationsError } from '@deepseek-ai/dsh-stations'
import { StationSubprocessHandle } from './handle.ts'

/** Конфиг провайдера: какая станция — тот мир исполнения. */
export interface Config {
  /** Идентификатор сопряжённой станции из реестра ctx.stations. */
  stationId: string
}

function requireRepresentableGrace(graceMs: number): void {
  if (!Number.isFinite(graceMs) || graceMs <= 0 || graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`graceMs должен быть положительным конечным числом не больше ${String(MAX_TIMER_DELAY_MS)}`)
  }
}

/**
 * Менеджер процессов станции, регистрируется как ctx.subprocess.
 * Каждый spawn вычищает окружение хоста (scrubbedParentEnv) и накладывает
 * явные записи спеки: тот же скраб, что у локального бэкенда, — дети
 * станции не видят ни секретов хоста, ни его DSH_*-фактов.
 */
export class StationSubprocessRuntime extends SubprocessRuntime {
  static inject = ['stations']

  static Config: z<Config> = z.object({
    stationId: z.string().required(),
  })

  private readonly stationId: import('@deepseek-ai/dsh-station-protocol').StationId
  private readonly live = new Set<StationSubprocessHandle>()

  /**
   * Строит провайдера и вешает teardown: живые дети станции гасятся
   * принудительно, каждый exit ждётся в пределах разумного.
   * @param ctx - контекст с сервисом станций.
   * @param config - проверенный конфиг.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.stationId = config.stationId as import('@deepseek-ai/dsh-station-protocol').StationId
    ctx.effect(() => async () => {
      const pending: Promise<unknown>[] = []
      for (const handle of [...this.live]) {
        handle.terminate()
        pending.push(handle.waitForExit())
      }
      const outcomes = await Promise.allSettled(pending)
      const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'subprocess-station: teardown failed')
    }, 'subprocess-station teardown')
  }

  /** Живой мост; офлайн-станция — ошибка запуска конкретного spawn. */
  private bridge(): import('@deepseek-ai/dsh-stations').StationBridge {
    try {
      return this.ctx.stations.bridge(this.stationId)
    } catch (error) {
      if (error instanceof StationsError) {
        throw new Error(`subprocess-station: ${error.message}`, { cause: error })
      }
      throw error
    }
  }

  /** @inheritdoc */
  async resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    if (command.length === 0) throw new Error('subprocess-station: имя исполняемого не может быть пустым')
    signal?.throwIfAborted()
    const pathEnv = env?.PATH
    const result = await this.bridge().request('proc/resolve', {
      command,
      ...(pathEnv === undefined ? {} : { pathEnv }),
    }, signal === undefined ? {} : { signal })
    return result.executable
  }

  /** @inheritdoc */
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const program = spec.argv[0]
    if (program === undefined || program.length === 0) {
      throw new Error('invalid argv: expected a non-empty program name at argv[0]')
    }
    requireRepresentableGrace(spec.graceMs)
    if (spec.signal?.aborted === true) {
      throw new Error(`aborted before spawn: ${String(spec.signal.reason)}`)
    }
    // Скраб хоста + явные записи спеки: итог едет по проводу целиком,
    // коннектор не смешивает своё окружение. undefined-значения спеки —
    // «убрать запись», поэтому их отсеиваем до провода.
    const env: Record<string, string> = { ...scrubbedParentEnv() }
    for (const [key, value] of Object.entries(spec.env ?? {})) {
      if (value === undefined) continue
      env[key] = value
    }
    const bridge = this.bridge()
    const handle = new StationSubprocessHandle(bridge, spec, env, spec.graceMs, () => this.bridge())
    this.live.add(handle)
    void handle.done.then(
      () => { this.release(handle) },
      () => { this.release(handle) },
    )
    // Отмена спеки: старт эскалации terminate — единственный глагол шва.
    spec.signal?.addEventListener('abort', () => { handle.terminate() }, { once: true })
    return handle
  }

  /** @inheritdoc */
  // oxlint-disable-next-line typescript/require-await -- async держит отказ типа rejected promise, а не синхронный throw
  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    void spec
    throw new Error('subprocess-station: терминальные сессии (PTY) через мост появятся на этапе 5b')
  }

  private release(handle: StationSubprocessHandle): void {
    this.live.delete(handle)
    handle.disposeListeners()
  }
}

export default StationSubprocessRuntime
