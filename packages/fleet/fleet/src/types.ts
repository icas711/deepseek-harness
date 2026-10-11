/**
 * Type contracts of the fleet orchestration service (`ctx.fleet`).
 * @module @deepseek-ai/dsh-fleet
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorktreeDiff } from '@deepseek-ai/dsh-worktree'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** Durable identity of one fanout. */
export type FleetFanoutId = Branded<'FleetFanoutId'>

/** Fully specified fanout request. */
export interface FleetFanoutRequest {
  /** Repository the attempts branch from (any of its working trees). */
  repoPath: string
  /** Number of parallel attempts (1..`maxMembers`). */
  count: number
  /** The prompt every attempt receives verbatim. */
  prompt: string
  /** Base committish for every attempt branch (default: the repository's HEAD). */
  baseRef?: string
}

/** One attempt of one fanout. */
export interface FleetMember {
  /** The attempt's live/persisted session identity. */
  sessionId: SessionId
  /** Branch checked out in the attempt's worktree. */
  branch: string
  /** The attempt's isolated working tree. */
  worktreePath: string
  /** Workspace registry id when a workspace was registered for the worktree. */
  workspaceId?: WorkspaceId
}

/** Live state of one attempt, derived from the agent registry. */
export type FleetMemberState = 'starting' | 'running' | 'idle' | 'gone'

/** One member with its derived live state. */
export interface FleetMemberStatus extends FleetMember {
  /** Agent-registry-derived state of the attempt. */
  state: FleetMemberState
}

/** Public view of one fanout. */
export interface FleetSnapshot {
  /** Fanout identity. */
  id: FleetFanoutId
  /** Session that started the fanout; the only caller its verbs accept. */
  ownerSession: SessionId
  /** Repository the attempts branched from. */
  repoPath: string
  /** Base ref as requested (default was `'HEAD'`). */
  baseRef: string
  /** Resolved base commit every attempt branched at. */
  baseSha: string
  /** The prompt every attempt received. */
  prompt: string
  /** Creation time in milliseconds since the epoch. */
  createdAt: number
  /** Member with its branch that was merged, when a merge happened. */
  mergedSessionId?: SessionId
  /** Members with derived live state, in attempt order. */
  members: FleetMemberStatus[]
}

/** Diff of one attempt plus the shared base facts. */
export interface FleetMemberDiff {
  /** Session identity of the attempt. */
  sessionId: SessionId
  /** Branch of the attempt. */
  branch: string
  /** The worktree diff against the fanout base. */
  diff: WorktreeDiff
}

/** Owner-fence rejection facts for a foreign caller. */
export interface FleetOwnerError {
  /** The fanout the caller addressed. */
  id: FleetFanoutId
  /** The session that owns it. */
  ownerSession: SessionId
}
