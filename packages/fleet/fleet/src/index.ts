/**
 * The fleet orchestration service (`ctx.fleet`): worktree-fanout — one prompt delivered to N parallel
 * top-level sessions, each isolated in its own git worktree of a base repository. Member sessions are
 * ordinary sessions (cwd = worktree) grouped under registered workspaces, so every existing surface —
 * Web GUI, phone browser, persistence — observes and steers them without new UI. The service owns member
 * agent handles for its lifetime and stops them at composition teardown; worktrees stay on disk as the
 * durable artifacts of the attempts. Fanout records are process-local: a restart keeps the worktrees,
 * workspaces, and persisted sessions, and a new fanout re-branches; durable fleet state is deferred.
 * @module @deepseek-ai/dsh-fleet
 */

import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import type AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { BranchMergeResult } from '@deepseek-ai/dsh-worktree'
import type {} from '@deepseek-ai/dsh-workspace'
import type {
  FleetFanoutId,
  FleetFanoutRequest,
  FleetMemberDiff,
  FleetMemberState,
  FleetSnapshot,
} from './types.ts'

export type {
  FleetFanoutId,
  FleetFanoutRequest,
  FleetMember,
  FleetMemberDiff,
  FleetMemberState,
  FleetMemberStatus,
  FleetSnapshot,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleet: Fleet
  }
}

/** Service configuration. */
export interface Config {
  /** Maximum attempts one fanout may start. */
  maxMembers: number
  /** Maximum `delegationDepth` a session may fan out at; member depth is the owner's plus one. */
  maxFanoutDepth: number
}

/** Durable facts of one fanout, before live member states are projected. */
interface FanoutFacts {
  id: FleetFanoutId
  ownerSession: SessionId
  repoPath: string
  baseRef: string
  baseSha: string
  prompt: string
  createdAt: number
  mergedSessionId?: SessionId
}

/** One fanout's facts plus the live handles and notice bookkeeping the service owns. */
interface FanoutEntry {
  facts: FanoutFacts
  members: FleetSnapshot['members']
  handles: Map<SessionId, AgentHandle>
  notified: Set<SessionId>
}

/** The fanout-facing error: foreign owner. */
export class FleetForeignOwnerError extends Error {
  constructor(readonly facts: { id: FleetFanoutId; ownerSession: SessionId }) {
    super(`fleet: fanout ${facts.id} belongs to session ${facts.ownerSession}`)
  }
}

/** Reject a limits value the fanout caps could not act on, shared by Config and the settings namespace. */
function assertLimits(value: Config): void {
  if (!Number.isInteger(value.maxMembers) || value.maxMembers < 1) {
    throw new Error('fleet: maxMembers must be a positive integer')
  }
  if (!Number.isInteger(value.maxFanoutDepth) || value.maxFanoutDepth < 0) {
    throw new Error('fleet: maxFanoutDepth must be a non-negative integer')
  }
}

/**
 * Worktree-fanout orchestration over `ctx.worktrees`, `ctx.agents`, and the workspace registry.
 * Mounts as `ctx.fleet`.
 */
export class Fleet extends Service {
  static inject = ['worktrees', 'agents']

  static Config: z<Config> = z.object({
    maxMembers: z.number().default(5),
    maxFanoutDepth: z.number().default(2),
  })

  constructor(ctx: Context, config: Config) {
    super(ctx, 'fleet')
    assertLimits(config)
    this.limits = { ...config }
    this.entries = new Map()
    // Live limits override: the settings namespace `fleet` wins while a settings
    // provider is mounted, and its detach falls back to the composition entry.
    // The registration rides the service's own fiber, so a composition without
    // a settings provider keeps the entry limits standing.
    ctx.inject(['settings'], (settingsCtx) => {
      const scope = settingsCtx.settings.register(settingsNamespace('fleet'), Fleet.Config, {
        base: { ...config },
        validate: assertLimits,
      })
      const read = (): void => {
        this.limits = { maxMembers: scope.get().maxMembers, maxFanoutDepth: scope.get().maxFanoutDepth }
      }
      read()
      const stop = scope.watch(read)
      settingsCtx.effect(() => stop, 'fleet: settings-limits watch')
      settingsCtx.effect(() => () => {
        this.limits = { ...config }
      }, 'fleet: settings-detach fallback')
    })
    // One listener serves every member session's first turn/end with an owner notice.
    ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/end') this.onTurnEnd(session.id)
    })
    ctx.effect(() => () => {
      for (const entry of this.entries.values()) {
        for (const handle of entry.handles.values()) void handle.dispose()
      }
      this.entries.clear()
    })
  }

  private limits: Config
  private readonly entries: Map<FleetFanoutId, FanoutEntry>

  /**
   * Start one fanout: create isolated worktrees, register workspaces, start member agents, deliver the prompt.
   * @param request - fully specified fanout request.
   * @param owner - the live agent whose session owns the fanout; its depth bounds recursion.
   * @returns the fanout snapshot after every attempt started.
   * @throws when the request is invalid, the depth cap is exceeded, or git refuses a worktree (already-created attempts roll back).
   */
  async fanout(request: FleetFanoutRequest, owner: Agent): Promise<FleetSnapshot> {
    const prompt = request.prompt.trim()
    if (prompt.length === 0) throw new Error('fleet: prompt must be a non-empty string')
    if (!isAbsolute(request.repoPath)) throw new Error('fleet: repoPath must be an absolute path')
    if (!Number.isInteger(request.count) || request.count < 1 || request.count > this.limits.maxMembers) {
      throw new Error(`fleet: count must be an integer between 1 and ${String(this.limits.maxMembers)}`)
    }
    const depth = owner.session.header.delegationDepth ?? 0
    if (depth >= this.limits.maxFanoutDepth) {
      throw new Error(`fleet: fanout depth cap reached (${String(this.limits.maxFanoutDepth)})`)
    }
    const baseRef = request.baseRef ?? 'HEAD'
    const baseSha = await this.ctx.worktrees.resolveCommit(request.repoPath, baseRef)
    const fanoutId = `fleet-${randomUUID()}` as FleetFanoutId
    const shortId = fanoutId.slice('fleet-'.length, 'fleet-'.length + 8)
    const root = join(dirname(request.repoPath), `${basename(request.repoPath)}-dsh-fleet`, shortId)
    const entry: FanoutEntry = {
      facts: {
        id: fanoutId,
        ownerSession: owner.id,
        repoPath: request.repoPath,
        baseRef,
        baseSha,
        prompt,
        createdAt: Date.now(),
      },
      members: [],
      handles: new Map(),
      notified: new Set(),
    }
    this.entries.set(fanoutId, entry)
    try {
      for (let index = 1; index <= request.count; index++) {
        await this.startMember(entry, shortId, index, root, depth)
      }
    } catch (error: unknown) {
      await this.rollback(entry)
      this.entries.delete(fanoutId)
      throw error
    }
    return this.snapshotOf(entry)
  }

  /**
   * Start one member: worktree, workspace registration, agent, prompt delivery.
   * @param entry - the fanout being built.
   * @param shortId - the fanout's short id segment shared by branch and directory names.
   * @param index - one-based attempt number.
   * @param root - directory all of this fanout's worktrees live under.
   * @param ownerDepth - the owner's delegation depth.
   */
  private async startMember(entry: FanoutEntry, shortId: string, index: number, root: string, ownerDepth: number): Promise<void> {
    const worktreePath = join(root, `m${String(index)}`)
    const branch = `dsh-fleet/${shortId}/m${String(index)}`
    await this.ctx.worktrees.create({ repoPath: entry.facts.repoPath, worktreePath, branch, baseRef: entry.facts.baseSha })
    const workspaces = this.ctx.get('workspaceRegistry')
    const workspace = workspaces === undefined
      ? undefined
      : await workspaces.create(worktreePath, `fleet ${shortId} m${String(index)}`)
    let handle: AgentHandle
    const agentOptions = this.memberRoute()
    try {
      handle = await this.ctx.agents.create({
        sessionId: `session-${randomUUID()}` as SessionId,
        meta: { cwd: worktreePath, delegationDepth: ownerDepth + 1 },
        ...agentOptions === undefined ? {} : { agentOptions },
      })
    } catch (error: unknown) {
      await this.ctx.worktrees.remove({ repoPath: entry.facts.repoPath, worktreePath, deleteBranch: true, force: true })
      throw error
    }
    entry.handles.set(handle.agent.id, handle)
    entry.members.push({
      sessionId: handle.agent.id,
      branch,
      worktreePath,
      ...workspace === undefined ? {} : { workspaceId: workspace.id },
      state: 'starting',
    })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: entry.facts.prompt }],
      source: { kind: 'user' },
    }))
  }

  /**
   * Resolve the member agents' provider/model route from the default-model service, the same
   * source every host create/resume declares. Compositions without that service create members
   * with no route; their first turn then fails loud with the loop's own no-provider error.
   * @returns the seed AgentOptions, or undefined when no default selection exists.
   */
  private memberRoute(): AgentOptions | undefined {
    const defaults: AgentDefaultModelConfig | undefined = this.ctx.get('agentDefaultModel')
    if (defaults === undefined) return undefined
    const { provider, model } = defaults.currentSelection()
    return { provider, model }
  }

  /**
   * Roll back a partially built fanout: stop started agents and remove created worktrees.
   * @param entry - the fanout being abandoned.
   */
  private async rollback(entry: FanoutEntry): Promise<void> {
    for (const handle of entry.handles.values()) await handle.dispose()
    for (const member of entry.members) {
      await this.ctx.worktrees.remove({
        repoPath: entry.facts.repoPath,
        worktreePath: member.worktreePath,
        deleteBranch: true,
        force: true,
      })
    }
  }

  /**
   * Fanout snapshots visible to one caller: the caller's own fanouts, newest first, or one by id.
   * @param caller - the live agent asking.
   * @param fanoutId - restrict the answer to one fanout.
   * @returns snapshots newest-first; one fanout for an exact id.
   * @throws FleetForeignOwnerError when the addressed fanout belongs to another session.
   */
  status(caller: Agent, fanoutId?: FleetFanoutId): FleetSnapshot[] {
    if (fanoutId !== undefined) {
      return [this.snapshotOf(this.owned(fanoutId, caller))]
    }
    return [...this.entries.values()]
      .filter(entry => entry.facts.ownerSession === caller.id)
      .map(entry => this.snapshotOf(entry))
      .reverse()
  }

  /**
   * Diff every attempt of one fanout against the shared base commit.
   * @param caller - the live agent asking; must own the fanout.
   * @param fanoutId - the fanout to diff.
   * @returns one diff per member, in attempt order.
   * @throws FleetForeignOwnerError when the fanout belongs to another session.
   */
  async diff(caller: Agent, fanoutId: FleetFanoutId): Promise<FleetMemberDiff[]> {
    const entry = this.owned(fanoutId, caller)
    const diffs: FleetMemberDiff[] = []
    for (const member of entry.members) {
      diffs.push({
        sessionId: member.sessionId,
        branch: member.branch,
        diff: await this.ctx.worktrees.diff(member.worktreePath, entry.facts.baseSha),
      })
    }
    return diffs
  }

  /**
   * Merge one attempt's branch into the base repository's current HEAD. The winner must have finished
   * (no live running agent); a conflicting merge is aborted and reported, never auto-retried.
   * @param caller - the live agent asking; must own the fanout.
   * @param fanoutId - the fanout to merge from.
   * @param sessionId - the member whose branch wins.
   * @returns the merge classification and combined git output.
   * @throws FleetForeignOwnerError when the fanout belongs to another session, or when the member is unknown or still running.
   */
  async merge(caller: Agent, fanoutId: FleetFanoutId, sessionId: SessionId): Promise<BranchMergeResult> {
    const entry = this.owned(fanoutId, caller)
    const member = entry.members.find(candidate => candidate.sessionId === sessionId)
    if (member === undefined) throw new Error(`fleet: session ${String(sessionId)} is not a member of ${String(fanoutId)}`)
    const agent = this.ctx.agents.get(sessionId)
    if (agent !== undefined && agent.status === 'running') {
      throw new Error(`fleet: attempt ${String(sessionId)} is still running; wait for it to finish before merging`)
    }
    const result = await this.ctx.worktrees.mergeBranch(entry.facts.repoPath, member.branch)
    if (result.status === 'merged' || result.status === 'up-to-date') {
      entry.facts.mergedSessionId = sessionId
    }
    return result
  }

  /**
   * Remove one fanout: stop member agents, delete worktrees and their branches, unregister workspaces.
   * The fanout record leaves the registry; persisted member sessions stay.
   * @param caller - the live agent asking; must own the fanout.
   * @param fanoutId - the fanout to remove.
   * @throws FleetForeignOwnerError when the fanout belongs to another session.
   */
  async cleanup(caller: Agent, fanoutId: FleetFanoutId): Promise<void> {
    const entry = this.owned(fanoutId, caller)
    this.entries.delete(fanoutId)
    for (const handle of entry.handles.values()) await handle.dispose()
    const workspaces = this.ctx.get('workspaceRegistry')
    for (const member of entry.members) {
      if (workspaces !== undefined && member.workspaceId !== undefined) await workspaces.delete(member.workspaceId)
      await this.ctx.worktrees.remove({
        repoPath: entry.facts.repoPath,
        worktreePath: member.worktreePath,
        deleteBranch: true,
        force: true,
      })
    }
  }

  /** Resolve one fanout entry and enforce the owner fence. */
  private owned(fanoutId: FleetFanoutId, caller: Agent): FanoutEntry {
    const entry = this.entries.get(fanoutId)
    if (entry === undefined) throw new Error(`fleet: unknown fanout ${String(fanoutId)}`)
    if (entry.facts.ownerSession !== caller.id) throw new FleetForeignOwnerError({ id: fanoutId, ownerSession: entry.facts.ownerSession })
    return entry
  }

  /** Project one entry with live member states. */
  private snapshotOf(entry: FanoutEntry): FleetSnapshot {
    const members = entry.members.map(member => ({ ...member, state: this.stateOf(member.sessionId) }))
    return { ...entry.facts, members }
  }

  /** Derive one member's live state from the agent registry. */
  private stateOf(sessionId: SessionId): FleetMemberState {
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined) return 'gone'
    return agent.status === 'running' ? 'running' : 'idle'
  }

  /**
   * First turn/end of one member session notifies the owner agent once. A busy owner is injected;
   * an idle owner is woken, mirroring the job-completion delivery lanes.
   */
  private onTurnEnd(sessionId: SessionId): void {
    for (const entry of this.entries.values()) {
      if (!entry.members.some(member => member.sessionId === sessionId)) continue
      if (entry.notified.has(sessionId)) return
      entry.notified.add(sessionId)
      const owner = this.ctx.agents.get(entry.facts.ownerSession)
      if (owner === undefined || owner.id === sessionId) return
      const notice = createUserMessage({
        content: [{
          type: 'text',
          text: `fleet ${String(entry.facts.id)}: attempt ${String(sessionId)} finished. Review with fleet_diff and pick a winner with fleet_merge.`,
        }],
        source: { kind: 'user' },
      })
      if (owner.status === 'running') owner.inject(notice)
      else owner.followup(notice)
      return
    }
  }
}

export default Fleet
