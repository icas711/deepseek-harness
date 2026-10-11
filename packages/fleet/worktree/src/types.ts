/**
 * Type contracts of the worktree capability (`ctx.worktrees`).
 * @module @deepseek-ai/dsh-worktree
 */

/** Settled outcome of one git invocation: exit facts plus collected text. */
export interface GitCommandResult {
  /** Exit code; null when git died from a signal. */
  exitCode: number | null
  /** Collected stdout (bounded by the service's `maxOutputBytes`). */
  stdout: string
  /** Collected stderr (bounded by the service's `maxOutputBytes`). */
  stderr: string
}

/** One linked or main worktree as `git worktree list --porcelain` reports it. */
export interface WorktreeRecord {
  /** Absolute working-tree path. */
  path: string
  /** Checked-out branch short name; null for detached or bare entries. */
  branch: string | null
  /** Commit the worktree has checked out. */
  head: string
  /** True for the repository's main working tree (the first porcelain entry). */
  main: boolean
}

/** Fully specified worktree creation request. */
export interface WorktreeCreateSpec {
  /** Repository any of whose objects resolves the base (usually the main working tree). */
  repoPath: string
  /** Working-tree path to create; `git worktree add` refuses an existing non-empty directory. */
  worktreePath: string
  /** New branch name created at the base ref; git fails loud on collision. */
  branch: string
  /** Base committish for the new branch (default: the repository's HEAD). */
  baseRef?: string
  /** Aborts a running creation; the caller owns the deadline. */
  signal?: AbortSignal
}

/** Worktree removal request. */
export interface WorktreeRemoveSpec {
  /** Repository that owns the worktree registration. */
  repoPath: string
  /** Working-tree path to remove. */
  worktreePath: string
  /** Delete the checked-out branch after removal (`git branch -D`). */
  deleteBranch?: boolean
  /** Remove even with uncommitted or untracked files (`git worktree remove --force`). */
  force?: boolean
  /** Aborts a running removal; the caller owns the deadline. */
  signal?: AbortSignal
}

/** Unified and stat diffs of one branch against a base commit. */
export interface WorktreeDiff {
  /** Working-tree path the diff was taken in. */
  worktreePath: string
  /** Base commit both sides share (`git merge-base`). */
  mergeBase: string
  /** `git diff --stat <mergeBase>..HEAD` text. */
  stat: string
  /** `git diff <mergeBase>..HEAD` unified text (bounded). */
  diff: string
}

/** Classification of one `git merge` attempt. */
export type BranchMergeStatus = 'merged' | 'up-to-date' | 'conflict' | 'error'

/** Result of merging one branch into the current HEAD of a repository. */
export interface BranchMergeResult {
  /** Classification of the attempt. */
  status: BranchMergeStatus
  /** Combined git output (stdout and stderr) that produced the classification. */
  output: string
}
