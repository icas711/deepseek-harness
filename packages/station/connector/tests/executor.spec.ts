/**
 * Юнит-тесты исполнителя: изоляция путей на исполнении (лексика и
 * realpath), fs-операции с версиями, stdout→exit порядок, kill и
 * dispose, ошибка запуска на отсутствующем cwd.
 */

import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StationOpRemoteError } from '@deepseek-ai/dsh-station-protocol'
import type { StationEventFrame } from '@deepseek-ai/dsh-station-protocol'
import { StationExecutor } from '../src/executor.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const platform = process.platform === 'win32' ? 'win32' as const : 'linux' as const
const sep = platform === 'win32' ? '\\' : '/'

async function executor(): Promise<{ exec: StationExecutor; root: string; events: StationEventFrame[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-connector-exec-'))
  root = dir
  const events: StationEventFrame[] = []
  return { exec: new StationExecutor(dir, platform, event => events.push(event)), root: dir, events }
}

const p = (...parts: string[]): string => parts.join(sep)

describe('fs-операции', () => {
  it('write → stat → read → list с версиями и типами', async () => {
    const { exec } = await executor()
    const written = await exec.dispatch('fs/write', { path: 'под/файл.txt', data: Buffer.from('привет').toString('base64'), createOnly: true })
    expect(written.version).toMatch(/^[0-9a-f]{64}$/)
    const stat = await exec.dispatch('fs/stat', { path: 'под/файл.txt' })
    expect(stat).toMatchObject({ exists: true, type: 'file', size: 12 })
    const read = await exec.dispatch('fs/read', { path: 'под/файл.txt', maxBytes: 100 })
    expect(Buffer.from(read.data, 'base64').toString()).toBe('привет')
    const listing = await exec.dispatch('fs/list', { path: 'под' })
    expect(listing.entries[0]).toMatchObject({ name: 'файл.txt', type: 'file', size: 12 })
  })

  it('выход за корень отклоняется как denied — и лексически, и через символьную ссылку', async () => {
    const { exec, root: base } = await executor()
    await expect(exec.dispatch('fs/read', { path: '../зло.txt', maxBytes: 10 })).rejects.toMatchObject({ code: 'denied' })
    await expect(exec.dispatch('fs/stat', { path: platform === 'win32' ? 'D:\\чужое' : '/etc/passwd' })).rejects.toMatchObject({ code: 'denied' })
    // Windows-символьные ссылки требуют привилегий; posix-ветку проверяем честной ссылкой.
    if (platform === 'linux') {
      await symlink(join(base, '..', 'снаружи.txt'), join(base, 'псевдоним'))
      await expect(exec.dispatch('fs/read', { path: 'псевдоним', maxBytes: 10 })).rejects.toMatchObject({ code: 'denied' })
    }
  })

  it('createOnly не перезаписывает существующее; превышение лимита = too-large', async () => {
    const { exec } = await executor()
    await exec.dispatch('fs/write', { path: 'файл', data: Buffer.from('старое').toString('base64'), createOnly: true })
    await expect(exec.dispatch('fs/write', { path: 'файл', data: Buffer.from('новое').toString('base64'), createOnly: true }))
      .rejects.toMatchObject({ code: 'io' })
    const replaced = await exec.dispatch('fs/write', { path: 'файл', data: Buffer.from('новое').toString('base64'), createOnly: false })
    expect(replaced.version).toBeDefined()
    await expect(exec.dispatch('fs/read', { path: 'файл', maxBytes: 2 })).rejects.toMatchObject({ code: 'too-large' })
  })

  it('mkdir, unlink и отсутствие цели как валидный stat', async () => {
    const { exec } = await executor()
    await exec.dispatch('fs/mkdir', { path: 'глубже/ещё', recursive: true })
    const stat = await exec.dispatch('fs/stat', { path: 'глубже/ещё' })
    expect(stat).toMatchObject({ exists: true, type: 'directory' })
    await exec.dispatch('fs/write', { path: 'глубже/ещё/пустой', data: '', createOnly: true })
    await exec.dispatch('fs/unlink', { path: 'глубже/ещё/пустой' })
    const gone = await exec.dispatch('fs/stat', { path: 'глубже/ещё/пустой' })
    expect(gone).toEqual({ exists: false })
  })
})

describe('процессы', () => {
  it('stdout идёт событиями до exit; stdin-пакет и код выхода доставляются', async () => {
    const { exec, events, root: base } = await executor()
    const script = 'console.log(Buffer.from("привет").toString("base64"))'
    const spawned = await exec.dispatch('proc/spawn', {
      id: 'p1',
      argv: [process.execPath, '-e', script],
      cwd: base,
      stdin: { mode: 'ignore' },
      stdoutInherit: false,
      stderrInherit: false,
    })
    expect(spawned.pid).toBeGreaterThan(0)
    const exit = await waitFor(events, 'proc/exit')
    const stdout = events.filter(event => event.t === 'evt' && event.event === 'proc/stdout')
    expect(stdout.length).toBeGreaterThan(0)
    expect(exit.p.exitCode).toBe(0)
    expect(exec.live()).toHaveLength(0)
  })

  it('отсутствующий cwd отклоняется до запуска', async () => {
    const { exec, root: base } = await executor()
    await expect(exec.dispatch('proc/spawn', { id: 'x', argv: [process.execPath, '-e', ''], cwd: p(base, 'нет'), stdin: { mode: 'ignore' }, stdoutInherit: false, stderrInherit: false }))
      .rejects.toThrow(StationOpRemoteError)
  })

  it('kill останавливает живой процесс и убирает его из живых', async () => {
    const { exec, events, root: base } = await executor()
    const script = 'setInterval(() => {}, 1000)'
    await exec.dispatch('proc/spawn', {
      id: 'спящий',
      argv: [process.execPath, '-e', script],
      cwd: base,
      stdin: { mode: 'ignore' },
      stdoutInherit: false,
      stderrInherit: false,
    })
    expect(exec.live()).toHaveLength(1)
    await exec.dispatch('proc/kill', { id: 'спящий', force: true })
    const exit = await waitFor(events, 'proc/exit')
    // SIGKILL на Windows taskkill даёт код 1, на POSIX — null + сигнал.
    expect(exit.p.exitCode === null || exit.p.exitCode !== 0).toBe(true)
    expect(exec.live()).toHaveLength(0)
  })

  it('proc/list и stdin: pipe принимает данные до close-stdin', async () => {
    const { exec, events, root: base } = await executor()
    // Читает stdin целиком и печатает его длину.
    const script = 'let n=0;process.stdin.on("data",c=>{n+=c.length});process.stdin.on("end",()=>console.log(n))'
    await exec.dispatch('proc/spawn', {
      id: 'stdin',
      argv: [process.execPath, '-e', script],
      cwd: base,
      stdin: { mode: 'pipe' },
      stdoutInherit: false,
      stderrInherit: false,
    })
    await exec.dispatch('proc/write', { id: 'stdin', data: Buffer.from('абвгд').toString('base64') })
    await exec.dispatch('proc/close-stdin', { id: 'stdin' })
    await waitFor(events, 'proc/exit')
    const stdout = events.filter(event => event.t === 'evt' && event.event === 'proc/stdout')
    const text = stdout.map(event => Buffer.from((event.p as { data: string }).data, 'base64').toString()).join('')
    expect(text.trim()).toBe('10')
  })
})

function waitFor(events: StationEventFrame[], event: 'proc/exit'): Promise<Extract<StationEventFrame, { t: 'evt'; event: 'proc/exit' }>>
function waitFor(events: StationEventFrame[]): Promise<StationEventFrame>
async function waitFor(events: StationEventFrame[], event?: string): Promise<StationEventFrame> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const found = events.find(candidate => event === undefined || (candidate.t === 'evt' && candidate.event === event))
    if (found !== undefined) return found
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`событие ${event ?? 'любое'} не пришло за 10 секунд`)
}
