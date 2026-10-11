// Real-git behavior of the worktree service: create/list/diff/merge/remove over
// temporary repositories through the local subprocess provider, plus the pure
// porcelain parser. Skips loudly when git is unavailable on the host.
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import Worktrees, { parseWorktreePorcelain } from '@deepseek-ai/dsh-worktree'
import { name as invariantName, apply as invariantApply } from '@deepseek-ai/dsh-worktree/invariant'

const exec = promisify(execFile)

let root: string | undefined
let ctx: Context | undefined

beforeAll(async () => {
  try {
    await exec('git', ['--version'])
  } catch {
    describe.skip('git unavailable', () => {})
    return
  }
}, 30_000)

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot the worktree service over the real local subprocess provider. */
async function boot(): Promise<Context> {
  const context = new Context()
  await context.plugin(SubprocessLocal)
  await context.plugin(Worktrees)
  ctx = context
  return context
}

/** Create a temporary git repository with one commit on `main`. */
async function makeRepo(dir: string): Promise<string> {
  const repo = join(dir, 'repo')
  await mkdir(repo, { recursive: true })
  await exec('git', ['-C', repo, 'init', '-b', 'main'])
  await exec('git', ['-C', repo, 'config', 'user.email', 'fleet@test'])
  await exec('git', ['-C', repo, 'config', 'user.name', 'fleet test'])
  await writeFile(join(repo, 'hello.txt'), 'hello\n')
  await exec('git', ['-C', repo, 'add', '.'])
  await exec('git', ['-C', repo, 'commit', '-m', 'init'])
  return repo
}

describe('parseWorktreePorcelain', () => {
  it('parses main first, branches, detached, and bare entries', () => {
    const stdout = [
      'worktree /repo',
      'HEAD 0123456789abcdef0123456789abcdef01234567',
      'branch refs/heads/main',
      '',
      'worktree /repo-wt',
      'HEAD fedcba9876543210fedcba9876543210fedcba98',
      'branch refs/heads/attempt',
      '',
      'worktree /repo-detached',
      'HEAD aaaabbbbccccddddaaaabbbbccccddddaaaabbbb',
      'detached',
      '',
      'worktree /repo-bare',
      'HEAD 0000000000000000000000000000000000000001',
      'bare',
      '',
    ].join('\n')
    const records = parseWorktreePorcelain(stdout)
    expect(records.map(record => [record.path, record.main, record.branch])).toEqual([
      ['/repo', true, 'main'],
      ['/repo-wt', false, 'attempt'],
      ['/repo-detached', false, null],
      ['/repo-bare', false, null],
    ])
  })

  it('rejects empty output and a line before any entry', () => {
    expect(() => parseWorktreePorcelain('')).toThrow(/no worktrees/)
    expect(() => parseWorktreePorcelain('HEAD x')).toThrow(/before any worktree entry/)
  })
})

describe('Worktrees service over real git', () => {
  it('create/list/remove round-trips one worktree with its branch', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-worktree-'))
    const repo = await makeRepo(root)
    const context = await boot()
    const worktreePath = join(root, 'wt')
    const created = await context.worktrees.create({ repoPath: repo, worktreePath, branch: 'attempt-1' })
    expect(created.branch).toBe('attempt-1')
    expect(created.main).toBe(false)
    expect(created.head).toMatch(/^[0-9a-f]{40}$/)

    const listed = await context.worktrees.list(repo)
    expect(listed.find(record => record.path === worktreePath)?.branch).toBe('attempt-1')

    await context.worktrees.remove({ repoPath: repo, worktreePath, deleteBranch: true })
    expect((await context.worktrees.list(repo)).some(record => record.path === worktreePath)).toBe(false)
    const branches = await exec('git', ['-C', repo, 'branch', '--list', 'attempt-1'])
    expect(branches.stdout.trim()).toBe('')
  }, 60_000)

  it('diff reports changes against the shared base and merge applies the winner', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-worktree-'))
    const repo = await makeRepo(root)
    const context = await boot()
    const worktreePath = join(root, 'wt')
    await context.worktrees.create({ repoPath: repo, worktreePath, branch: 'attempt-1' })
    await appendFile(join(worktreePath, 'hello.txt'), 'attempt line\n')
    // Uncommitted work already shows in the diff (the attempt's visible effect).
    await writeFile(join(worktreePath, 'new-file.txt'), 'brand new\n')
    const uncommitted = await context.worktrees.diff(worktreePath, 'main')
    expect(uncommitted.stat).toContain('hello.txt')
    expect(uncommitted.stat).toContain('(untracked) new-file.txt')
    expect(uncommitted.diff).toContain('+attempt line')
    await exec('git', ['-C', worktreePath, 'add', '.'])
    await exec('git', ['-C', worktreePath, 'commit', '-m', 'attempt'])

    const diff = await context.worktrees.diff(worktreePath, 'main')
    expect(diff.stat).toContain('hello.txt')
    expect(diff.diff).toContain('+attempt line')
    expect(diff.mergeBase).toMatch(/^[0-9a-f]{40}$/)

    const merged = await context.worktrees.mergeBranch(repo, 'attempt-1')
    expect(merged.status).toBe('merged')
    const again = await context.worktrees.mergeBranch(repo, 'attempt-1')
    expect(again.status).toBe('up-to-date')
  }, 60_000)

  it('a conflicting merge is aborted and classified, leaving the base clean', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-worktree-'))
    const repo = await makeRepo(root)
    const context = await boot()
    await context.worktrees.create({ repoPath: repo, worktreePath: join(root, 'wt-a'), branch: 'attempt-a' })
    await context.worktrees.create({ repoPath: repo, worktreePath: join(root, 'wt-b'), branch: 'attempt-b' })
    await appendFile(join(root, 'wt-a', 'hello.txt'), 'from a\n')
    await appendFile(join(root, 'wt-b', 'hello.txt'), 'from b\n')
    await exec('git', ['-C', join(root, 'wt-a'), 'add', '.'])
    await exec('git', ['-C', join(root, 'wt-a'), 'commit', '-m', 'a'])
    await exec('git', ['-C', join(root, 'wt-b'), 'add', '.'])
    await exec('git', ['-C', join(root, 'wt-b'), 'commit', '-m', 'b'])
    await exec('git', ['-C', repo, 'merge', '--no-edit', 'attempt-a'])

    const conflict = await context.worktrees.mergeBranch(repo, 'attempt-b')
    expect(conflict.status).toBe('conflict')
    // The abort restored the base to the merged state of attempt-a only.
    const status = await exec('git', ['-C', repo, 'status', '--porcelain'])
    expect(status.stdout).toBe('')
  }, 60_000)

  it('fails loud with git stderr for a bad ref', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-worktree-'))
    const repo = await makeRepo(root)
    const context = await boot()
    await expect(context.worktrees.resolveCommit(repo, 'no-such-ref')).rejects.toThrow(/no-such-ref/)
  }, 60_000)
})

describe('invariant companion', () => {
  it('registers the package-owned invariant installer', async () => {
    const context = new Context()
    const registered: string[] = []
    ;(context as unknown as { invariants: { register: (n: string) => () => void } }).invariants = {
      register: (n: string) => {
        registered.push(n)
        return () => {}
      },
    }
    const dispose = await invariantApply(context)
    expect(registered).toEqual(['@deepseek-ai/dsh-worktree'])
    expect(invariantName).toBe('worktree-invariant')
    dispose()
  })
})
