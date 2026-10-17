/**
 * Провайдер файловой системы над мостом станций: тот же шов ctx.fs, что и
 * локальный/удалённый бэкенды, но каждый ход — операция протокола станции.
 * Изоляция путей двоится: хост проверяет корень реестра до отправки,
 * коннектор — свой корень перед исполнением.
 * @module @deepseek-ai/dsh-fs-station
 */

import { Buffer } from 'node:buffer'
import { posix, win32 } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveWithinRoot } from '@deepseek-ai/dsh-station-protocol'
import type { StationId, StationPlatform, StationStatResult } from '@deepseek-ai/dsh-station-protocol'
import { StationsError } from '@deepseek-ai/dsh-stations'
import type { StationBridge } from '@deepseek-ai/dsh-stations'
import { FileSystem, FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type {
  FsDirEntry, FsEditOutcome, FsEditRequest, FsInfo, FsPathInfo,
  FsTarget, FsWriteIntent, FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'

/** Умолчание транспортного лимита чтения: страховка провода, не политика. */
const DEFAULT_READ_LIMIT_BYTES = 50 * 1024 * 1024

/** Конфиг провайдера: станция и транспортная граница чтения. */
export interface Config {
  /** Идентификатор сопряжённой станции из реестра ctx.stations. */
  stationId: string
  /** Верхняя граница одного чтения через мост в байтах. */
  readLimitBytes?: number
}

function assertNotAborted(signal: AbortSignal | undefined, operation: string): void {
  if (signal?.aborted === true) throw new FsError(`${operation} прервано`, 'FS_ABORTED')
}

function normalizeLineEndings(value: string): string {
  return value.replaceAll('\r\n', '\n')
}

/**
 * Литеральна правка текста за один проход: самостоятельная реализация,
 * чтобы не делить с e2b-бэкендом клон выше порога дублирования.
 */
function literalEdit(content: string, request: FsEditRequest, displayPath: string): string {
  const oldText = normalizeLineEndings(request.oldString)
  const newText = normalizeLineEndings(request.newString)
  if (oldText.length === 0) {
    throw new FsError(`не правится «${displayPath}»: old_string обязан быть непустым`, 'FS_EDIT_NOT_FOUND')
  }
  let hits = 0
  let at = content.indexOf(oldText)
  while (at >= 0) {
    hits += 1
    at = content.indexOf(oldText, at + oldText.length)
  }
  if (hits === 0) throw new FsError(`не правится «${displayPath}»: old_string не найден`, 'FS_EDIT_NOT_FOUND')
  if (!request.replaceAll && hits !== 1) {
    throw new FsError(`не правится «${displayPath}»: old_string совпал ${String(hits)} раз`, 'FS_AMBIGUOUS_EDIT')
  }
  let out = ''
  let cursor = 0
  at = content.indexOf(oldText)
  while (at >= 0) {
    out += content.slice(cursor, at) + newText
    cursor = at + oldText.length
    if (!request.replaceAll) break
    at = content.indexOf(oldText, cursor)
  }
  return out + content.slice(cursor)
}

/**
 * Декодирует байты моста в текст: бинарное содержимое и не-UTF-8
 * отклоняются теми же кодами, что и у локального бэкенда.
 */
function decodeText(bytes: Uint8Array, displayPath: string): string {
  if (bytes.subarray(0, 8192).includes(0)) {
    throw new FsError(`не читается «${displayPath}»: бинарный файл`, 'FS_NOT_TEXT')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error: unknown) {
    throw new FsError(`не читается «${displayPath}»: файл не является корректным UTF-8 текстом`, 'FS_NOT_TEXT', { cause: error })
  }
}

/**
 * Файловая система станции, регистрируется как ctx.fs. Цель — абсолютный
 * путь в языке платформы станции; версия — метка фактов stat коннектора.
 */
export class StationFileSystem extends FileSystem {
  static inject = ['stations']

  static Config: z<Config> = z.object({
    stationId: z.string().required(),
    readLimitBytes: z.natural().default(DEFAULT_READ_LIMIT_BYTES),
  })

  private readonly stationId: StationId
  private readonly readLimit: number
  /** Корень и платформа с момента первого resolve; для sync-contains. */
  private world: { rootPath: string; platform: StationPlatform } | undefined

  /**
   * Строит провайдера над сервисом станций.
   * @param ctx - контекст с сервисом станций.
   * @param config - проверенный конфиг (умолчания Schemastery применены).
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    const resolved = config as Config & { readLimitBytes: number }
    if (!Number.isSafeInteger(resolved.readLimitBytes) || resolved.readLimitBytes <= 0) {
      throw new Error('fs-station: readLimitBytes должен быть положительным целым')
    }
    this.stationId = resolved.stationId as StationId
    this.readLimit = resolved.readLimitBytes
  }

  /** Живой мост; офлайн-станция — понятная ошибка шва, а не «упало где-то». */
  private bridge(): StationBridge {
    try {
      return this.ctx.stations.bridge(this.stationId)
    } catch (error) {
      throw this.mapRemote(error, `станция офлайн`)
    }
  }

  /** Корень и платформа из реестра; офлайн-реестр знает их по-прежнему. */
  private async worldOf(): Promise<{ rootPath: string; platform: StationPlatform }> {
    if (this.world !== undefined) return this.world
    const described = await this.ctx.stations.describe(this.stationId)
    if (described === undefined) {
      throw new FsError('станция не сопряжена: идентификатор неизвестен реестру', 'FS_NOT_FOUND')
    }
    this.world = described
    return described
  }

  /** @inheritdoc */
  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    assertNotAborted(opts?.signal, 'resolve')
    if (path.trim().length === 0) throw new FsError('file_path обязан быть непустой строкой', 'FS_NOT_FOUND')
    const { rootPath, platform } = await this.worldOf()
    const module = platform === 'win32' ? win32 : posix
    const candidate = opts?.cwd === undefined ? path : module.join(opts.cwd, path)
    // Абсолютный candidate резолвится как есть; выход за корень — отказ.
    const displayPath = resolveWithinRoot(rootPath, candidate, platform)
    // Офлайн-станция резолву не мешает: ключ пути стабилен без связи.
    return { targetKey: FsTargetKey(displayPath), displayPath }
  }

  /** @inheritdoc */
  override processPath(target: FsTarget): string {
    return String(target.targetKey)
  }

  /** @inheritdoc */
  override fileUrl(target: FsTarget): string {
    const path = this.processPath(target)
    if (path.startsWith('/')) {
      return `file://${path.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
    }
    return `file:///${path.split('\\').map(segment => encodeURIComponent(segment)).join('/')}`
  }

  /** @inheritdoc */
  override contains(parent: FsTarget, child: FsTarget): boolean {
    // Мир обязано дать хотя бы одно resolve — цель приходит из этого провайдера.
    const known = this.world
    if (known === undefined) return false
    const module = known.platform === 'win32' ? win32 : posix
    const same = (value: string): string => known.platform === 'win32' ? value.toLowerCase() : value
    const relative = module.relative(same(String(parent.targetKey)), same(String(child.targetKey)))
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${module.sep}`) && !module.isAbsolute(relative))
  }

  /** @inheritdoc */
  override async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    assertNotAborted(signal, 'stat')
    const result = await this.probe(target, false, signal)
    if (result === undefined) return undefined
    return {
      version: FsVersion(result.version),
      type: result.type === 'symlink' ? 'other' : result.type,
      ...(result.type === 'file' && result.size !== undefined ? { size: result.size } : {}),
    }
  }

  /** @inheritdoc */
  override async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    assertNotAborted(signal, 'lstat')
    if (path.trim().length === 0) throw new FsError('file_path обязан быть непустой строкой', 'FS_NOT_FOUND')
    const target = await this.resolve(path, opts?.cwd === undefined ? {} : { cwd: opts.cwd })
    const result = await this.probe(target, true, signal)
    if (result === undefined) return undefined
    return {
      version: FsVersion(result.version),
      type: result.type,
      ...(result.type === 'file' && result.size !== undefined ? { size: result.size } : {}),
    }
  }

  /** @inheritdoc */
  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    const result = await this.readBytes(target, signal, this.readLimit)
    return decodeText(result, target.displayPath)
  }

  /** @inheritdoc */
  override async streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    const whole = await this.readText(target, signal)
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        // Чтение через мост ограничено readLimitBytes, поэтому разбиение —
        // вопрос потребления, а не памяти: отдаём кусками по 64 КиБ.
        for (let at = 0; at < whole.length; at += 65_536) {
          assertNotAborted(signal, 'read')
          yield whole.slice(at, at + 65_536)
        }
      },
    }
  }

  /** @inheritdoc */
  override async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    assertNotAborted(signal, 'read')
    const bridge = this.bridge()
    try {
      const result = await bridge.request('fs/read', { path: String(target.targetKey), maxBytes }, { signal })
      return new Uint8Array(Buffer.from(result.data, 'base64'))
    } catch (error) {
      throw this.mapRemote(error, `чтение «${target.displayPath}»`)
    }
  }

  /** @inheritdoc */
  override async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    assertNotAborted(signal, 'list')
    const { platform } = await this.worldOf()
    const bridge = this.bridge()
    let result
    try {
      result = await bridge.request('fs/list', { path: String(target.targetKey) }, { signal })
    } catch (error) {
      throw this.mapRemote(error, `список «${target.displayPath}»`)
    }
    return result.entries.map(entry => {
      const childPath = joinPath(platform, String(target.targetKey), entry.name)
      return {
        name: entry.name,
        type: entry.type === 'symlink' ? 'other' : entry.type,
        target: { targetKey: FsTargetKey(childPath), displayPath: childPath },
        ...(entry.size !== undefined ? { size: entry.size } : {}),
      }
    })
  }

  /** @inheritdoc */
  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome> {
    void sandboxPolicy
    assertNotAborted(signal, 'write')
    const bridge = this.bridge()
    const existing = await this.stat(target, signal)
    if (expected?.kind === 'createIfAbsent' && existing !== undefined) {
      throw new FsError(`нельзя перезаписать существующую «${target.displayPath}», не прочитав её`, 'FS_NOT_OBSERVED')
    }
    if (expected?.kind === 'replaceIfVersion') {
      if (existing === undefined || existing.version !== expected.version) {
        throw new FsError(`нельзя записать «${target.displayPath}»: файл изменился с момента чтения`, 'FS_STALE_VERSION')
      }
    }
    let before: string | null = null
    if (existing !== undefined) {
      try {
        before = normalizeLineEndings(await this.readText(target, signal))
      } catch (error) {
        if (!(error instanceof FsError) || error.code !== 'FS_NOT_TEXT') throw error
        // Бинарное прошлое остаётся null-базой — контракт outcome.
      }
    }
    let written
    try {
      written = await bridge.request('fs/write', {
        path: String(target.targetKey),
        data: Buffer.from(content, 'utf8').toString('base64'),
        createOnly: false,
      }, { signal })
    } catch (error) {
      throw this.mapRemote(error, `запись «${target.displayPath}»`)
    }
    return {
      operation: existing === undefined ? 'create' : 'update',
      version: FsVersion(written.version),
      before,
      after: normalizeLineEndings(content),
    }
  }

  /** @inheritdoc */
  override async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: ReturnType<typeof FsVersion> },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsEditOutcome> {
    void sandboxPolicy
    assertNotAborted(signal, 'edit')
    const existing = await this.stat(target, signal)
    if (existing === undefined) {
      throw new FsError(`не правится «${target.displayPath}»: файл изменился с момента чтения`, 'FS_STALE_VERSION')
    }
    if (expected !== undefined && existing.version !== expected.version) {
      throw new FsError(`не правится «${target.displayPath}»: файл изменился с момента чтения`, 'FS_STALE_VERSION')
    }
    const raw = await this.readText(target, signal)
    const before = normalizeLineEndings(raw)
    const after = literalEdit(before, edit, target.displayPath)
    const written = await this.writeText(target, after, undefined, signal)
    return { version: written.version, before, after }
  }

  /** stat-зонд станции: absent — undefined, прочий отказ — коды шва. */
  private async probe(target: FsTarget, lstat: boolean, signal: AbortSignal | undefined): Promise<StationStatResult | undefined> {
    const bridge = this.bridge()
    let result
    try {
      result = await bridge.request('fs/stat', { path: String(target.targetKey), ...(lstat ? { lstat: true } : {}) }, { signal })
    } catch (error) {
      throw this.mapRemote(error, `stat «${target.displayPath}»`)
    }
    return result.exists ? result : undefined
  }

  /** Отказ моста в кодах шва fs. */
  private mapRemote(error: unknown, operation: string): FsError {
    if (error instanceof FsError) return error
    if (error instanceof StationsError) {
      return new FsError(`${operation}: ${error.message}`, error.code === 'unknown-station' ? 'FS_NOT_FOUND' : 'FS_IO_ERROR', { cause: error })
    }
    const code = (error as { code?: unknown }).code
    if (code === 'not-found') return new FsError(`${operation}: путь не найден`, 'FS_NOT_FOUND', { cause: error })
    if (code === 'denied') return new FsError(`${operation}: путь вне корня станции`, 'FS_SANDBOX_DENIED', { cause: error })
    if (code === 'too-large') return new FsError(`${operation}: превышен лимит чтения`, 'FS_TOO_LARGE', { cause: error })
    return new FsError(`${operation} не удалось: ${error instanceof Error ? error.message : String(error)}`, 'FS_IO_ERROR', { cause: error })
  }
}

function joinPath(platform: StationPlatform, base: string, name: string): string {
  const module = platform === 'win32' ? win32 : posix
  return module.join(base, name)
}

export default StationFileSystem
