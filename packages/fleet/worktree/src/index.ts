/**
 * The worktree capability service (`ctx.worktrees`): git-backed worktree lifecycle plus the branch diff/merge
 * verbs a fleet needs. The Service Definition and the local git provider share this package until a second
 * provider (remote execution worlds) evolves independently. Every verb runs one bounded git child through the
 * subprocess seam and fails loud, passing git's stderr through; no verb shells out through a shell.
 * @module @deepseek-ai/dsh-worktree
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolve } from 'node:path'
import { deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { SubprocessCollect, SubprocessOutputReader, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type {
  BranchMergeResult,
  GitCommandResult,
  WorktreeCreateSpec,
  WorktreeDiff,
  WorktreeRecord,
  WorktreeRemoveSpec,
} from './types.ts'

export type {
  BranchMergeResult,
  BranchMergeStatus,
  GitCommandResult,
  WorktreeCreateSpec,
  WorktreeDiff,
  WorktreeRecord,
  WorktreeRemoveSpec,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktrees: Worktrees
  }
}

/** Git-output environment: no color or pager variance between hosts and platforms. */
const GIT_ENV = {
  NO_COLOR: '1',
  TERM: 'dumb',
  GIT_PAGER: 'cat',
  LC_ALL: 'C',
} as const

/** Service configuration. */
export interface Config {
  /** Git executable (bare PATH name or absolute path). */
  command: string
  /** Per-invocation timeout in milliseconds. */
  timeoutMs: number
  /** Per-stream in-memory output cap; a longer tail is truncated from the head. */
  maxOutputBytes: number
  /** SIGTERM→SIGKILL grace for a timed-out git child. */
  graceMs: number
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`worktree: ${name} must be a positive finite number`)
  }
}

/**
 * Reject an unusable resolved config at load instead of at the next git call.
 * @param config - the resolved config, schema-valid by construction.
 * @throws Error naming the field that cannot be used.
 */
export function assertServiceableConfig(config: Config): void {
  assertPositiveFinite('timeoutMs', config.timeoutMs)
  assertPositiveFinite('maxOutputBytes', config.maxOutputBytes)
  assertPositiveFinite('graceMs', config.graceMs)
  if (config.graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`worktree: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** Read one settled collect-mode reader to its final text. */
function finalText(reader: SubprocessOutputReader): string {
  return reader.readFrom(0).text
}

/** One porcelain entry under construction. */
interface PartialRecord {
  path?: string
  head?: string
  branch?: string | null
  bare?: boolean
}

/**
 * Parse `git worktree list --porcelain` output. The main working tree is always
 * the first entry; a `bare` entry carries no branch. Path names containing
 * newlines are not representable in the non-`-z` porcelain this provider reads
 * (older gits lack `-z` for `worktree list`) and surface as a parse failure.
 * @param stdout - the complete porcelain stdout.
 * @returns records in git's order.
 */
export function parseWorktreePorcelain(stdout: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = []
  let current: PartialRecord | null = null
  for (const line of stdout.split('\n')) {
    if (line === '' || line.endsWith('\r') && line.trimEnd() === '') {
      if (current?.path !== undefined) records.push(commit(current))
      current = null
      continue
    }
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line
    if (clean.startsWith('worktree ')) {
      if (current?.path !== undefined) records.push(commit(current))
      current = { path: clean.slice('worktree '.length) }
    } else if (current === null) {
      throw new Error('worktree: unexpected porcelain line before any worktree entry')
    } else if (clean.startsWith('HEAD ')) {
      current.head = clean.slice('HEAD '.length)
    } else if (clean.startsWith('branch ')) {
      current.branch = clean.slice('branch refs/heads/'.length)
    } else if (clean === 'bare') {
      current.bare = true
    } else if (clean === 'detached') {
      current.branch = null
    }
  }
  if (current?.path !== undefined) records.push(commit(current))
  if (records.length === 0) throw new Error('worktree: porcelain output named no worktrees')
  return records.map((record, index) => ({ ...record, main: index === 0 }))
}

/** Finish one parsed entry, failing loud on missing fields. */
function commit(partial: PartialRecord): WorktreeRecord {
  if (partial.path === undefined || partial.head === undefined || (partial.branch === undefined && partial.bare !== true)) {
    throw new Error('worktree: incomplete porcelain entry')
  }
  return { path: partial.path, head: partial.head, branch: partial.branch ?? null, main: false }
}

/**
 * Local git-backed worktree service. Mounts as `ctx.worktrees` and spawns git
 * through `ctx.subprocess` with this service's configured budgets, so a hung
 * git child is terminated at composition teardown like every other managed
 * process.
 */
export class Worktrees extends Service {
  static inject = ['subprocess']

  static Config: z<Config> = z.object({
    command: z.string().default('git'),
    timeoutMs: z.number().default(60_000),
    maxOutputBytes: z.number().default(1_000_000),
    graceMs: z.number().default(5_000),
  })

  constructor(ctx: Context, config: Config) {
    super(ctx, 'worktrees')
    assertServiceableConfig(config)
    this.config = config
  }

  /** Validated config (schemastery applied the defaults before construction). */
  private readonly config: Config

  /**
   * Run one git invocation to settlement and return its exit facts and output.
   * @param cwd - working directory for the child.
   * @param args - git arguments after the executable.
   * @param signal - caller-owned cancellation for the whole invocation.
   * @returns exit code plus collected stdout/stderr.
   * @throws when the spawn itself fails (git missing) or the invocation times out; both are fail-loud conditions.
   */
  async exec(cwd: string, args: readonly string[], signal?: AbortSignal): Promise<GitCommandResult> {
    const argv = [this.config.command, ...args]
    const collect = (): SubprocessCollect => ({ maxBytes: this.config.maxOutputBytes })
    const spec: SubprocessSpawnSpec = {
      argv,
      cwd,
      stdio: { stdin: 'ignore', stdout: collect(), stderr: collect() },
      graceMs: this.config.graceMs,
      signal,
      env: GIT_ENV,
    }
    const handle = this.ctx.subprocess.spawn(spec)
    const outcome = await handle.done
    const stdout = handle.collected.stdout
    const stderr = handle.collected.stderr
    if (stdout === undefined || stderr === undefined) {
      throw new Error('worktree: subprocess implementation dropped a requested collect stream')
    }
    return { exitCode: outcome.exitCode, stdout: finalText(stdout), stderr: finalText(stderr) }
  }

  /**
   * Run one git invocation that must succeed, with this service's timeout as the deadline.
   * @param cwd - working directory for the child.
   * @param args - git arguments after the executable.
   * @param what - operation name for timeout and failure text.
   * @param signal - caller-owned cancellation folded into the same deadline.
   * @returns stdout of the successful invocation.
   * @throws the collected stderr (or timeout text) when git exits nonzero.
   */
  private async must(cwd: string, args: readonly string[], what: string, signal?: AbortSignal): Promise<string> {
    using d = deadline(signal, this.config.timeoutMs, 'WORKTREE_TIMEOUT')
    const result = await this.exec(cwd, args, d.signal)
    if (timeoutOf(d.signal, 'WORKTREE_TIMEOUT') !== undefined) {
      throw new Error(`worktree: ${what} timed out after ${this.config.timeoutMs}ms`)
    }
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.exitCode)}`
      throw new Error(`worktree: ${what} failed: ${detail}`)
    }
    return result.stdout
  }

  /**
   * Resolve a committish to its full object name in a repository.
   * @param repoPath - repository to resolve in.
   * @param ref - any committish (HEAD, branch, sha).
   * @returns the full commit sha.
   */
  async resolveCommit(repoPath: string, ref: string): Promise<string> {
    return (await this.must(repoPath, ['rev-parse', '--verify', `${ref}^{commit}`], `resolving ${ref}`)).trim()
  }

  /**
   * Create one linked worktree on a new branch at a base ref.
   * @param spec - fully specified creation request.
   * @returns the created record with its checked-out commit.
   * @throws when git refuses (existing branch, dirty target) with git's stderr.
   */
  async create(spec: WorktreeCreateSpec): Promise<WorktreeRecord> {
    const args = ['worktree', 'add', '-b', spec.branch, spec.worktreePath]
    if (spec.baseRef !== undefined) args.push(spec.baseRef)
    await this.must(spec.repoPath, args, `creating worktree ${spec.worktreePath}`, spec.signal)
    const head = await this.resolveCommit(spec.worktreePath, 'HEAD')
    return { path: resolve(spec.worktreePath), branch: spec.branch, head, main: false }
  }

  /**
   * List the worktrees one repository has registered. Paths are normalized to the platform's
   * native separators (git porcelain emits forward slashes everywhere).
   * @param repoPath - repository to list.
   * @returns records in git's order (the main working tree first).
   */
  async list(repoPath: string): Promise<WorktreeRecord[]> {
    const stdout = await this.must(repoPath, ['worktree', 'list', '--porcelain'], 'listing worktrees')
    return parseWorktreePorcelain(stdout).map(record => ({ ...record, path: resolve(record.path) }))
  }

  /**
   * Remove one linked worktree and optionally delete its branch.
   * @param spec - fully specified removal request.
   * @throws when git refuses (locked worktree, dirty without force) with git's stderr.
   */
  async remove(spec: WorktreeRemoveSpec): Promise<void> {
    const args = ['worktree', 'remove', ...spec.force === true ? ['--force'] : [], spec.worktreePath]
    const listed = await this.list(spec.repoPath)
    const entry = listed.find(record => record.path === spec.worktreePath)
    await this.must(spec.repoPath, args, `removing worktree ${spec.worktreePath}`, spec.signal)
    if (spec.deleteBranch === true && entry?.branch !== undefined && entry.branch !== null) {
      await this.must(spec.repoPath, ['branch', '-D', entry.branch], `deleting branch ${entry.branch}`, spec.signal)
    }
  }

  /**
   * Diff one worktree's working tree (committed and uncommitted changes) against the merge base it
   * shares with a base ref: an attempt's whole visible effect, not only its commits. Tracked
   * changes produce unified and stat diffs; untracked files (an attempt's new files) are appended
   * to the stat section as `(untracked) <path>` lines — the worktree's index is never mutated to
   * force them into the unified diff.
   * @param worktreePath - the linked worktree whose working tree is diffed.
   * @param baseRef - the other side of the merge base.
   * @param signal - caller-owned cancellation.
   * @returns unified and stat diffs.
   */
  async diff(worktreePath: string, baseRef: string, signal?: AbortSignal): Promise<WorktreeDiff> {
    const mergeBase = (await this.must(worktreePath, ['merge-base', baseRef, 'HEAD'], 'finding merge base', signal)).trim()
    const stat = await this.must(worktreePath, ['diff', '--stat', mergeBase], 'diffing (stat)', signal)
    const diff = await this.must(worktreePath, ['diff', mergeBase], 'diffing', signal)
    const untracked = await this.must(worktreePath, ['ls-files', '--others', '--exclude-standard'], 'listing untracked files', signal)
    const untrackedLines = untracked === '' ? [] : untracked.split('\n').filter(line => line !== '').map(path => `(untracked) ${path}`)
    return {
      worktreePath,
      mergeBase,
      stat: [...(stat === '' ? [] : [stat]), ...untrackedLines].join('\n'),
      diff,
    }
  }

  /**
   * Merge one branch into the current HEAD of a repository. A conflicting or
   * failed merge is aborted, leaving the repository on its pre-merge state;
   * the classification and combined output are the caller's to report.
   * @param repoPath - repository whose current HEAD receives the branch.
   * @param branch - branch name to merge.
   * @param signal - caller-owned cancellation.
   * @returns the classification and combined git output.
   */
  async mergeBranch(repoPath: string, branch: string, signal?: AbortSignal): Promise<BranchMergeResult> {
    using d = deadline(signal, this.config.timeoutMs, 'WORKTREE_TIMEOUT')
    const result = await this.exec(repoPath, ['merge', '--no-edit', branch], d.signal)
    const output = `${result.stdout}\n${result.stderr}`.trim()
    if (result.exitCode === 0) {
      return { status: /Already up to date/.test(result.stdout) ? 'up-to-date' : 'merged', output }
    }
    await this.exec(repoPath, ['merge', '--abort'], d.signal)
    const conflict = /CONFLICT|Automatic merge failed|Not possible to fast-forward/.test(output)
    return { status: conflict ? 'conflict' : 'error', output }
  }
}

export default Worktrees
