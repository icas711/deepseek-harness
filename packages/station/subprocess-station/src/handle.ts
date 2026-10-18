/**
 * Дескриптор процесса станции: сырые Readable для pipe-потоков, окна
 * collect-потоков с offset-чтением, terminate-эскалация по grace и done
 * по событию proc/exit моста. Контракт шва subprocess соблюдён целиком,
 * кроме терминалов: PTY через мост — этап 5b.
 * @module @deepseek-ai/dsh-subprocess-station/handle
 */

import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { StationOpRemoteError } from '@deepseek-ai/dsh-station-protocol'
import type { StationBridge } from '@deepseek-ai/dsh-stations'
import type {
  SubprocessHandle, SubprocessOutcome, SubprocessCollectedOutputs,
  SubprocessOutputReader, SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { OutputWindow } from './window.ts'

/** Верхняя граница окна collect-потока (хвост): страховка памяти хоста. */
const COLLECT_WINDOW_BYTES = 512 * 1024

/**
 * Живой процесс на станции, наблюдаемый через мост. После exit окна и
 * сырые потоки остаются читаемыми — собранный вывод не умирает с процессом.
 */
export class StationSubprocessHandle implements SubprocessHandle {
  private readonly disposers: Array<() => void> = []
  private readonly exit = Promise.withResolvers<SubprocessOutcome>()
  private readonly stdoutWindow = new OutputWindow(COLLECT_WINDOW_BYTES)
  private readonly stderrWindow = new OutputWindow(COLLECT_WINDOW_BYTES)
  private readonly rawStreams: { stdout?: Readable; stderr?: Readable } = {}
  private readonly stdinStream: Writable | undefined
  private terminated = false
  private processPid = -1

  /** Идентификатор процесса в мосту (минтует хост при spawn). */
  readonly id = randomUUID()

  /**
   * Запускает процесс через мост и подключает наблюдение событий.
   * @param bridge - живой мост станции на момент запуска.
   * @param spec - полностью определённый запрос шва.
   * @param env - итоговое окружение ребёнка (скраб хоста + явные записи).
   * @param graceMs - пауза эскалации terminate (шов требует её на спеке).
   * @param resolveBridge - свежий мост на момент terminate: соединение могло
   *   смениться с момента запуска.
   * @throws ошибка моста/станции — уровень запуска; при этом done тоже
   *   отклоняется, чтобы batch- и стрим-потребители видели один исход.
   */
  constructor(
    bridge: StationBridge,
    spec: SubprocessSpawnSpec,
    env: Record<string, string>,
    private readonly graceMs: number,
    private readonly resolveBridge: () => StationBridge,
  ) {
    const wantsRawStdout = spec.stdio.stdout === 'pipe'
    const wantsRawStderr = spec.stdio.stderr === 'pipe'
    if (wantsRawStdout) this.rawStreams.stdout = this.pumpRaw()
    if (wantsRawStderr) this.rawStreams.stderr = this.pumpRaw()
    if (spec.stdio.stdin === 'pipe') this.stdinStream = this.openStdin(bridge)
    const spawnRequest = bridge.request('proc/spawn', {
      id: this.id,
      argv: [...spec.argv],
      cwd: spec.cwd,
      ...(typeof spec.stdio.stdin === 'string'
        ? { stdin: { mode: 'ignore' as const } }
        : { stdin: { mode: 'data' as const, data: Buffer.from(spec.stdio.stdin.data, 'utf8').toString('base64') } }),
      stdoutInherit: spec.stdio.stdout === 'inherit',
      stderrInherit: spec.stdio.stderr === 'inherit',
      env,
    })
    const settled = spawnRequest.then(
      (result) => {
        this.processPid = result.pid
      },
      (error: unknown) => {
        // Уровень запуска: шов велит отклонить done, pid остаётся -1.
        this.exit.reject(error)
      },
    )
    const disposeEvents = bridge.onEvent((event) => {
      if (event.p.id !== this.id) return
      if (event.event === 'proc/stdout') this.absorb(this.stdoutWindow, this.rawStreams.stdout, event.p.data)
      if (event.event === 'proc/stderr') this.absorb(this.stderrWindow, this.rawStreams.stderr, event.p.data)
      if (event.event === 'proc/exit') {
        void settled.then(() => {
          // close-семантика коннектора гарантирует: вывод уже доставлен.
          this.exit.resolve({ exitCode: event.p.exitCode, signal: event.p.signal as SubprocessOutcome['signal'] })
        })
      }
    })
    this.disposers.push(disposeEvents)
  }

  /** @inheritdoc */
  get pid(): number {
    return this.processPid
  }

  /** @inheritdoc */
  get stdin(): Writable | undefined {
    return this.stdinStream
  }

  /** @inheritdoc */
  get stdout(): Readable | undefined {
    return this.rawStreams.stdout
  }

  /** @inheritdoc */
  get stderr(): Readable | undefined {
    return this.rawStreams.stderr
  }

  /** @inheritdoc */
  get collected(): SubprocessCollectedOutputs {
    return {
      stdout: this.readerOf(this.stdoutWindow),
      stderr: this.readerOf(this.stderrWindow),
    }
  }

  /** @inheritdoc */
  get done(): Promise<SubprocessOutcome> {
    return this.exit.promise
  }

  /**
   * @inheritdoc
   * Эскалация SIGTERM → graceMs → SIGKILL ведётся на хосте поверх
   * tree-kill коннектора; на Windows станция Terminates дерево сразу,
   * поэтому обе ступени сходятся в один taskkill.
   */
  terminate(): void {
    this.terminateWith(this.resolveBridge(), this.graceMs)
  }

  /**
   * @inheritdoc
   * Дерево наблюдает коннектор: exit событие означает close ребёнка и
   * его pipe-потоков.
   */
  async waitForExit(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted === true) return false
    if (!signal) {
      await this.exit.promise.catch(() => {})
      return true
    }
    return await new Promise<boolean>((resolve) => {
      const done = (won: boolean): void => {
        signal.removeEventListener('abort', onAbort)
        resolve(won)
      }
      const onAbort = (): void => { done(false) }
      signal.addEventListener('abort', onAbort, { once: true })
      this.exit.promise.then(
        () => { done(true) },
        () => { done(true) },
      )
    })
  }

  /** Отписывает события моста; живой ребёнок НЕ убивается — это делает dispose сервиса. */
  disposeListeners(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers.length = 0
  }

  /** Запрос kill через мост; force эскалирует дерево коннектора. */
  async requestKill(bridge: StationBridge, force: boolean): Promise<void> {
    await bridge.request('proc/kill', { id: this.id, force }).catch((error: unknown) => {
      if (error instanceof StationOpRemoteError && error.code === 'unknown-process') return
      throw error
    })
  }

  private terminateWith(bridge: StationBridge, graceMs: number): void {
    if (this.terminated) return
    this.terminated = true
    void (async () => {
      await this.requestKill(bridge, false)
      const timer = setTimeout(() => {
        void this.requestKill(bridge, true)
      }, graceMs)
      void this.exit.promise.catch(() => {}).then(() => { clearTimeout(timer) })
    })()
  }

  private absorb(window: OutputWindow, raw: Readable | undefined, data: string): void {
    const chunk = Buffer.from(data, 'base64')
    window.push(chunk)
    raw?.push(chunk)
  }

  private pumpRaw(): Readable {
    return new Readable({ read() {} })
  }

  private openStdin(bridge: StationBridge): Writable {
    return new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        bridge.request('proc/write', {
          id: this.id,
          data: chunk.toString('base64'),
        }).then(() => { callback() }, (error: unknown) => { callback(error instanceof Error ? error : new Error(String(error))) })
      },
      final: (callback) => {
        bridge.request('proc/close-stdin', { id: this.id }).then(() => { callback() }, (error: unknown) => { callback(error instanceof Error ? error : new Error(String(error))) })
      },
    })
  }

  private readerOf(window: OutputWindow): SubprocessOutputReader {
    return { readFrom: from => window.readFrom(from) }
  }
}
