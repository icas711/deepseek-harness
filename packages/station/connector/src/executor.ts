/**
 * Исполнитель операций на машине пользователя: fs поверх node:fs и
 * процессы поверх node:child_process, каждый путь — через двойную
 * проверку изоляции (лексика + realpath) из протокола. Процессы живут
 * в собственном наборе исполнителя: kill, список живых и принудительное
 * завершение при разрыве моста.
 * @module @deepseek-ai/dsh-station-connector/executor
 */

import { createHash } from 'node:crypto'
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, isAbsolute as posixIsAbsolute, win32 as win32Path } from 'node:path'
import { realpathWithinRoot, StationOpRemoteError, StationPathError } from '@deepseek-ai/dsh-station-protocol'
import type {
  StationDirEntry,
  StationEntryType,
  StationEventFrame,
  StationOpName,
  StationOpPayloadMap,
  StationOpValueMap,
  StationPlatform,
  StationStatResult,
} from '@deepseek-ai/dsh-station-protocol'

/** Канал событий исполнителя: сессия моста передаёт его отправку. */
export type StationEventSink = (event: StationEventFrame) => void

/** Один управляемый ребёнок: живёт, пока мост не получил proc/exit. */
interface ManagedChild {
  id: string
  child: ChildProcess
  argv: string[]
  /** false, пока не пришёл close — child ещё числится живым. */
  exited: boolean
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function entryTypeOf(isDirectory: boolean, isSymbolicLink: boolean): StationEntryType {
  return isSymbolicLink ? 'symlink' : isDirectory ? 'directory' : 'file'
}

/**
 * Метка версии файла для стражей записи: хэш фактов stat. Стабильна,
 * пока не изменились размер или время модификации — та же семантика,
 * что у удалённого бэкенда e2b, без обещаний глобальной уникальности.
 */
function versionOf(type: StationEntryType, size: number | undefined, mtimeMs: number): string {
  return createHash('sha256').update(`${type}:${size ?? ''}:${Math.round(mtimeMs)}`).digest('hex')
}

/**
 * Исполнитель моста. Один экземпляр на запущенный коннектор; корень и
 * платформа фиксируются при старте из локального конфига.
 */
export class StationExecutor {
  private readonly children = new Map<string, ManagedChild>()

  /**
   * Строит исполнителя над корневой папкой станции.
   * @param root - канонический (realpath) корень мира исполнения.
   * @param platform - платформа станции, владелец правил путей.
   * @param emit - канал событий (stdout/stderr/exit) в мост.
   */
  constructor(
    readonly root: string,
    readonly platform: StationPlatform,
    private readonly emit: StationEventSink,
  ) {}

  /** @returns снимок живых процессов моста. */
  live(): { id: string; pid: number; argv: string[] }[] {
    return [...this.children.values()]
      .filter(entry => !entry.exited)
      .map(entry => ({ id: entry.id, pid: entry.child.pid ?? -1, argv: [...entry.argv] }))
  }

  /**
   * Исполняет одну операцию протокола.
   * @param op - имя операции из закрытого юниона.
   * @param p - типизированная полезная нагрузка.
   * @returns значение ответа, суженное по операции.
   * @throws StationOpRemoteError — отказ операции (код стабилен);
   * @throws StationPathError — путь вне корня (сессия переводит в denied).
   */
  async dispatch<K extends StationOpName>(op: K, p: StationOpPayloadMap[K]): Promise<StationOpValueMap[K]> {
    try {
      return await this.dispatchInner(op, p) as StationOpValueMap[K]
    } catch (error) {
      // Канонизация пути бросает StationPathError до входа в обработчик:
      // единая точка перевода в стабильный код denied.
      if (error instanceof StationPathError) {
        throw new StationOpRemoteError('denied', error.message)
      }
      throw error
    }
  }

  /**
   * Таблица операций. Касты полезных нагрузок корректны: проводной декодер
   * уже проверил форму кадра по имени операции, а корреляцию «op ↔ p» TS
   * не сужает через общий дженерик (известное ограничение связанных юнионов).
   */
  private async dispatchInner(op: StationOpName, p: unknown): Promise<unknown> {
    switch (op) {
      case 'fs/stat':
        return await this.stat(p as StationOpPayloadMap['fs/stat'])
      case 'fs/list':
        return await this.list(p as StationOpPayloadMap['fs/list'])
      case 'fs/read':
        return await this.read(p as StationOpPayloadMap['fs/read'])
      case 'fs/write':
        return await this.write(p as StationOpPayloadMap['fs/write'])
      case 'fs/mkdir':
        return await this.mkdir(p as StationOpPayloadMap['fs/mkdir'])
      case 'fs/unlink':
        return await this.unlink(p as StationOpPayloadMap['fs/unlink'])
      case 'proc/resolve':
        return await this.resolveExecutable(p as StationOpPayloadMap['proc/resolve'])
      case 'proc/spawn':
        return await this.spawn(p as StationOpPayloadMap['proc/spawn'])
      case 'proc/write':
        return this.writeStdin(p as StationOpPayloadMap['proc/write'])
      case 'proc/close-stdin':
        return this.closeStdin(p as StationOpPayloadMap['proc/close-stdin'])
      case 'proc/kill':
        return await this.kill(p as StationOpPayloadMap['proc/kill'])
      case 'proc/list':
        return { processes: this.live() }
      default:
        throw new StationOpRemoteError('bad-request', `неизвестная операция ${JSON.stringify(String(op))}`)
    }
  }

  // ---- fs ------------------------------------------------------------------

  private async canonical(path: string): Promise<string> {
    return realpathWithinRoot(this.root, path, this.platform, target => realpath(target))
  }

  private async stat(p: StationOpPayloadMap['fs/stat']): Promise<StationStatResult> {
    const abs = await this.canonical(p.path)
    try {
      // lstat-режим не следует финальной символьной ссылке — так потребитель
      // шва fs видит саму ссылку, а не её цель.
      const info = p.lstat === true ? await lstat(abs) : await stat(abs)
      const type = entryTypeOf(info.isDirectory(), info.isSymbolicLink())
      return {
        exists: true,
        type,
        ...(info.isFile() ? { size: info.size } : {}),
        version: versionOf(type, info.isFile() ? info.size : undefined, info.mtimeMs),
      }
    } catch (error) {
      if (isENOENT(error)) return { exists: false }
      throw this.mapError(error, p.path)
    }
  }

  private async list(p: StationOpPayloadMap['fs/list']): Promise<StationOpValueMap['fs/list']> {
    const abs = await this.canonical(p.path)
    let dirents
    try {
      dirents = await readdir(abs, { withFileTypes: true })
    } catch (error) {
      throw this.mapError(error, p.path)
    }
    const entries: StationDirEntry[] = []
    for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
      const type = entryTypeOf(dirent.isDirectory(), dirent.isSymbolicLink())
      let size: number | undefined
      if (type === 'file') {
        try {
          size = (await stat(`${abs}/${dirent.name}`.replaceAll('/', this.platform === 'win32' ? '\\' : '/'))).size
        } catch {
          // Размер — факультативное поле: гонка удаления не рушит список.
        }
      }
      entries.push({ name: dirent.name, type, ...(size === undefined ? {} : { size }) })
    }
    return { entries }
  }

  private async read(p: StationOpPayloadMap['fs/read']): Promise<StationOpValueMap['fs/read']> {
    if (!Number.isSafeInteger(p.maxBytes) || p.maxBytes <= 0) {
      throw new StationOpRemoteError('bad-request', 'fs/read: maxBytes обязан быть положительным целым')
    }
    const abs = await this.canonical(p.path)
    let bytes: Buffer
    try {
      bytes = await readFile(abs)
    } catch (error) {
      throw this.mapError(error, p.path)
    }
    if (bytes.byteLength > p.maxBytes) {
      throw new StationOpRemoteError(
        'too-large',
        `файл «${p.path}» (${bytes.byteLength} байт) превышает лимит чтения ${p.maxBytes} байт`,
      )
    }
    return { data: bytes.toString('base64') }
  }

  private async write(p: StationOpPayloadMap['fs/write']): Promise<StationOpValueMap['fs/write']> {
    const abs = await this.canonical(p.path)
    const bytes = Buffer.from(p.data, 'base64')
    try {
      // Родителя создаём всегда: запись нового вложенного файла — обычный
      // исход моста; эксклюзивность createOnly охраняет сам файл, не папки.
      await mkdir(dirname(abs), { recursive: true })
      if (p.createOnly) {
        // Эксклюзивное создание: безопаснее атомарной замены с TOCTOU-окном.
        await writeFile(abs, bytes, { flag: 'wx', mode: 0o600 })
      } else {
        // Атомарная замена: временный файл рядом, затем rename.
        const temporary = `${abs}.dsh-station-${randomBytes(6).toString('hex')}.tmp`
        await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
        try {
          await rename(temporary, abs)
        } catch (error) {
          await unlink(temporary).catch(() => {
            // Первичная ошибка замены важнее неудачи уборки временного файла.
          })
          throw error
        }
      }
    } catch (error) {
      throw this.mapError(error, p.path)
    }
    const info = await stat(abs)
    return { version: versionOf('file', info.size, info.mtimeMs) }
  }

  private async mkdir(p: StationOpPayloadMap['fs/mkdir']): Promise<StationOpValueMap['fs/mkdir']> {
    const abs = await this.canonical(p.path)
    try {
      await mkdir(abs, { recursive: p.recursive })
    } catch (error) {
      throw this.mapError(error, p.path)
    }
    return {}
  }

  private async unlink(p: StationOpPayloadMap['fs/unlink']): Promise<StationOpValueMap['fs/unlink']> {
    const abs = await this.canonical(p.path)
    try {
      await access(abs, fsConstants.W_OK)
      await unlink(abs)
    } catch (error) {
      throw this.mapError(error, p.path)
    }
    return {}
  }

  // ---- proc ----------------------------------------------------------------

  private async resolveExecutable(p: StationOpPayloadMap['proc/resolve']): Promise<StationOpValueMap['proc/resolve']> {
    const command = p.command
    if (command.length === 0) {
      throw new StationOpRemoteError('bad-request', 'proc/resolve: имя команды не может быть пустым')
    }
    const isWindows = this.platform === 'win32'
    if (!/[\\/]/.test(command)) {
      // Имя без разделителей: ищем по PATH (и PATHEXT на Windows).
      const pathEnv = p.pathEnv ?? process.env.PATH ?? ''
      const exts = isWindows
        ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')
        : ['']
      for (const dir of pathEnv.split(isWindows ? ';' : ':')) {
        if (dir.length === 0) continue
        for (const ext of exts) {
          const candidate = `${dir}${isWindows ? '\\' : '/'}${command}${ext.toLowerCase()}`
          try {
            const info = await stat(candidate)
            if (info.isFile()) {
              if (!isWindows) await access(candidate, fsConstants.X_OK)
              return { executable: candidate }
            }
          } catch {
            // Следующий кандидат PATH; финальный промах даёт одну ошибку.
          }
        }
      }
      throw new StationOpRemoteError('not-found', `исполняемый файл «${command}» не найден в PATH станции`)
    }
    const absolute = isWindows ? win32Path.isAbsolute(command) : posixIsAbsolute(command)
    if (!absolute) {
      throw new StationOpRemoteError('bad-request', `proc/resolve: «${command}» — относительный путь; используйте абсолютный путь или голое имя для поиска по PATH`)
    }
    try {
      const info = await stat(command)
      if (!info.isFile()) {
        throw new StationOpRemoteError('not-found', `«${command}» не является файлом`)
      }
      if (!isWindows) await access(command, fsConstants.X_OK)
      return { executable: command }
    } catch (error) {
      if (error instanceof StationOpRemoteError) throw error
      throw new StationOpRemoteError('not-found', `исполняемый файл «${command}» не найден: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async spawn(p: StationOpPayloadMap['proc/spawn']): Promise<StationOpValueMap['proc/spawn']> {
    const program = p.argv[0]
    if (program === undefined || program.length === 0) {
      throw new StationOpRemoteError('bad-request', 'proc/spawn: argv обязан начинаться с непустой программы')
    }
    if (this.children.has(p.id)) {
      throw new StationOpRemoteError('bad-request', `proc/spawn: идентификатор «${p.id}» уже занят живым процессом`)
    }
    // Рабочий каталог обязан существовать и лежать в корне: канонизация
    // допускает отсутствующий хвост, поэтому существование проверяем явно.
    const cwd = await this.canonical(p.cwd)
    const cwdInfo = await stat(cwd).catch(() => undefined)
    if (cwdInfo === undefined || !cwdInfo.isDirectory()) {
      throw new StationOpRemoteError('not-found', `рабочий каталог «${p.cwd}» не найден на станции`)
    }
    const stdio: StdioOptionsLike = [
      p.stdin.mode === 'ignore' ? 'ignore' : 'pipe',
      p.stdoutInherit ? 'inherit' : 'pipe',
      p.stderrInherit ? 'inherit' : 'pipe',
    ]
    const child = nodeSpawn(program, p.argv.slice(1), {
      cwd,
      ...(p.env === undefined ? {} : { env: p.env }),
      stdio,
      // POSIX: собственная группа — tree-kill по -pid; Windows убивает дерево taskkill'ом.
      detached: this.platform !== 'win32',
      windowsHide: true,
    })
    const managed: ManagedChild = { id: p.id, child, argv: [...p.argv], exited: false }
    this.children.set(p.id, managed)
    child.on('error', () => {
      // Ошибка запуска (ENOENT): ребёнок никогда не жил; close не придёт.
      this.finishChild(managed)
      this.emit({ t: 'evt', event: 'proc/exit', p: { id: p.id, exitCode: null, signal: null } })
    })
    if (child.stdout !== null) {
      child.stdout.on('data', (chunk: Buffer) => {
        this.emit({ t: 'evt', event: 'proc/stdout', p: { id: p.id, data: chunk.toString('base64') } })
      })
    }
    if (child.stderr !== null) {
      child.stderr.on('data', (chunk: Buffer) => {
        this.emit({ t: 'evt', event: 'proc/stderr', p: { id: p.id, data: chunk.toString('base64') } })
      })
    }
    child.on('close', (exitCode, signal) => {
      // close = и процесс, и все pipe-потоки закрыты: события вывода уже
      // доставлены, порядок stdout → exit гарантирован порядком сокета.
      this.finishChild(managed)
      this.emit({ t: 'evt', event: 'proc/exit', p: { id: p.id, exitCode, signal } })
    })
    if (p.stdin.mode === 'data') {
      child.stdin?.end(Buffer.from(p.stdin.data, 'base64'))
    }
    return { pid: child.pid ?? -1 }
  }

  private writeStdin(p: StationOpPayloadMap['proc/write']): StationOpValueMap['proc/write'] {
    const managed = this.children.get(p.id)
    if (managed === undefined || managed.exited || managed.child.stdin === null) {
      throw new StationOpRemoteError('unknown-process', `процесс «${p.id}» не найден или stdin недоступен`)
    }
    managed.child.stdin.write(Buffer.from(p.data, 'base64'))
    return {}
  }

  private closeStdin(p: StationOpPayloadMap['proc/close-stdin']): StationOpValueMap['proc/close-stdin'] {
    const managed = this.children.get(p.id)
    if (managed === undefined || managed.exited || managed.child.stdin === null) {
      throw new StationOpRemoteError('unknown-process', `процесс «${p.id}» не найден или stdin недоступен`)
    }
    managed.child.stdin.end()
    return {}
  }

  private async kill(p: StationOpPayloadMap['proc/kill']): Promise<StationOpValueMap['proc/kill']> {
    const managed = this.children.get(p.id)
    if (managed === undefined || managed.exited) {
      throw new StationOpRemoteError('unknown-process', `процесс «${p.id}» не найден среди живых`)
    }
    const pid = managed.child.pid
    if (pid !== undefined) {
      if (this.platform === 'win32') {
        // Windows: дерево убивает taskkill; мягкого варианта нет.
        const killer = nodeSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        await new Promise<void>((resolve) => { killer.once('close', () => { resolve() }) })
      } else if (managed.child.pid !== undefined) {
        try {
          // Своя группа процесса: сигнал уходит всему дереву.
          process.kill(-pid, p.force ? 'SIGKILL' : 'SIGTERM')
        } catch {
          // Группа могла уже распасться — добиваем прямой процесс.
          try {
            managed.child.kill(p.force ? 'SIGKILL' : 'SIGTERM')
          } catch {
            // Процесс уже мёртв — исход тот же.
          }
        }
      }
    }
    return {}
  }

  /**
   * Принудительно завершает всех живых детей (разрыв моста или останов
   * коннектора) и ждёт их close, ограничивая ожидание, чтобы зависший
   * ребёнок не держал останов процесса.
   */
  async dispose(): Promise<void> {
    const live = [...this.children.values()].filter(entry => !entry.exited)
    await Promise.allSettled(live.map(entry => this.kill({ id: entry.id, force: true })))
    if (live.length === 0) return
    await new Promise<void>((resolve) => {
      const done = (): void => {
        if ([...this.children.values()].every(entry => entry.exited)) resolve()
      }
      for (const entry of live) entry.child.once('close', done)
      done()
      setTimeout(resolve, 3_000)
    })
  }

  private finishChild(managed: ManagedChild): void {
    managed.exited = true
    // Запись остаётся до close-потоков: proc/list читает exited.
  }

  private mapError(error: unknown, displayPath: string): StationOpRemoteError {
    if (error instanceof StationOpRemoteError) return error
    if (error instanceof StationPathError) {
      return new StationOpRemoteError('denied', error.message)
    }
    if (isENOENT(error)) {
      return new StationOpRemoteError('not-found', `путь «${displayPath}» не найден`)
    }
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code === 'EACCES' || code === 'EPERM') {
      return new StationOpRemoteError('denied', `доступ к «${displayPath}» запрещён (${code})`)
    }
    return new StationOpRemoteError('io', `операция над «${displayPath}» не удалась: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Локальный псевдоним, чтобы не тянуть тип только ради массива stdio. */
type StdioOptionsLike = ['ignore' | 'pipe' | 'inherit', 'ignore' | 'pipe' | 'inherit', 'ignore' | 'pipe' | 'inherit']
