# Флот worktree-фанлаута

Оркестрация «один промпт → N параллельных попыток»: каждая попытка — обычная сессия верхнего уровня в собственном git worktree базового репозитория, видимая во всех существующих поверхностях без нового UI. Решения и отвергнутые альтернативы — в [заметке о фанлауте](../../.agents/notes/implemented/feature/2026-10-11-worktree-fanout-fleet.md).

Слой состоит из двух пакетов:

- [`@deepseek-ai/dsh-worktree`](../../packages/fleet/worktree/README.md) — capability-пакет `ctx.worktrees`: жизненный цикл git worktree (create/list/remove) и веточные глаголы (diff рабочего дерева против merge-base с перечнем untracked-файлов, merge с откатом конфликта); каждый глагол — один ограниченный git-child через шов subprocess.
- [`@deepseek-ai/dsh-fleet`](../../packages/fleet/fleet/README.md) — служба `ctx.fleet`: запуск попыток (`ctx.agents.create` с `cwd` = worktree и маршрутом из `agentDefaultModel.currentSelection()`), owner-fence по `SessionId`, уведомление владельца о первом `turn/end` попытки, merge победителя и очистка. Model-facing Consumer — инструменты [`fleet_*`](../../packages/fleet/tool-fleet/README.md) из `@deepseek-ai/dsh-tool-fleet`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxfleet--fleet"></a>

### `ctx.fleet` — `Fleet`

Worktree-fanout orchestration over `ctx.worktrees`, `ctx.agents`, and the workspace registry. Mounts as `ctx.fleet`.

```ts cordis-catalog
/**
 * Start one fanout: create isolated worktrees, register workspaces, start member agents, deliver the prompt.
 * @param request - fully specified fanout request.
 * @param owner - the live agent whose session owns the fanout; its depth bounds recursion.
 * @returns the fanout snapshot after every attempt started.
 * @throws when the request is invalid, the depth cap is exceeded, or git refuses a worktree (already-created attempts roll back).
 */
async fanout(request: FleetFanoutRequest, owner: Agent): Promise<FleetSnapshot>

/**
 * Fanout snapshots visible to one caller: the caller's own fanouts, newest first, or one by id.
 * @param caller - the live agent asking.
 * @param fanoutId - restrict the answer to one fanout.
 * @returns snapshots newest-first; one fanout for an exact id.
 * @throws FleetForeignOwnerError when the addressed fanout belongs to another session.
 */
status(caller: Agent, fanoutId?: FleetFanoutId): FleetSnapshot[]

/**
 * Diff every attempt of one fanout against the shared base commit.
 * @param caller - the live agent asking; must own the fanout.
 * @param fanoutId - the fanout to diff.
 * @returns one diff per member, in attempt order.
 * @throws FleetForeignOwnerError when the fanout belongs to another session.
 */
async diff(caller: Agent, fanoutId: FleetFanoutId): Promise<FleetMemberDiff[]>

/**
 * Merge one attempt's branch into the base repository's current HEAD. The winner must have finished
 * (no live running agent); a conflicting merge is aborted and reported, never auto-retried.
 * @param caller - the live agent asking; must own the fanout.
 * @param fanoutId - the fanout to merge from.
 * @param sessionId - the member whose branch wins.
 * @returns the merge classification and combined git output.
 * @throws FleetForeignOwnerError when the fanout belongs to another session, or when the member is unknown or still running.
 */
async merge(caller: Agent, fanoutId: FleetFanoutId, sessionId: SessionId): Promise<BranchMergeResult>

/**
 * Remove one fanout: stop member agents, delete worktrees and their branches, unregister workspaces.
 * The fanout record leaves the registry; persisted member sessions stay.
 * @param caller - the live agent asking; must own the fanout.
 * @param fanoutId - the fanout to remove.
 * @throws FleetForeignOwnerError when the fanout belongs to another session.
 */
async cleanup(caller: Agent, fanoutId: FleetFanoutId): Promise<void>
```

Types: [Agent](core.md) · [SessionId](core.md)

Source: [`packages/fleet/fleet/src/index.ts:96`](../../packages/fleet/fleet/src/index.ts)

<a id="ctxworktrees--worktrees"></a>

### `ctx.worktrees` — `Worktrees`

Local git-backed worktree service. Mounts as `ctx.worktrees` and spawns git through `ctx.subprocess` with this service's configured budgets, so a hung git child is terminated at composition teardown like every other managed process.

```ts cordis-catalog
/**
 * Run one git invocation to settlement and return its exit facts and output.
 * @param cwd - working directory for the child.
 * @param args - git arguments after the executable.
 * @param signal - caller-owned cancellation for the whole invocation.
 * @returns exit code plus collected stdout/stderr.
 * @throws when the spawn itself fails (git missing) or the invocation times out; both are fail-loud conditions.
 */
async exec(cwd: string, args: readonly string[], signal?: AbortSignal): Promise<GitCommandResult>

/**
 * Resolve a committish to its full object name in a repository.
 * @param repoPath - repository to resolve in.
 * @param ref - any committish (HEAD, branch, sha).
 * @returns the full commit sha.
 */
async resolveCommit(repoPath: string, ref: string): Promise<string>

/**
 * Create one linked worktree on a new branch at a base ref.
 * @param spec - fully specified creation request.
 * @returns the created record with its checked-out commit.
 * @throws when git refuses (existing branch, dirty target) with git's stderr.
 */
async create(spec: WorktreeCreateSpec): Promise<WorktreeRecord>

/**
 * List the worktrees one repository has registered. Paths are normalized to the platform's
 * native separators (git porcelain emits forward slashes everywhere).
 * @param repoPath - repository to list.
 * @returns records in git's order (the main working tree first).
 */
async list(repoPath: string): Promise<WorktreeRecord[]>

/**
 * Remove one linked worktree and optionally delete its branch.
 * @param spec - fully specified removal request.
 * @throws when git refuses (locked worktree, dirty without force) with git's stderr.
 */
async remove(spec: WorktreeRemoveSpec): Promise<void>

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
async diff(worktreePath: string, baseRef: string, signal?: AbortSignal): Promise<WorktreeDiff>

/**
 * Merge one branch into the current HEAD of a repository. A conflicting or
 * failed merge is aborted, leaving the repository on its pre-merge state;
 * the classification and combined output are the caller's to report.
 * @param repoPath - repository whose current HEAD receives the branch.
 * @param branch - branch name to merge.
 * @param signal - caller-owned cancellation.
 * @returns the classification and combined git output.
 */
async mergeBranch(repoPath: string, branch: string, signal?: AbortSignal): Promise<BranchMergeResult>
```

Source: [`packages/fleet/worktree/src/index.ts:144`](../../packages/fleet/worktree/src/index.ts)
<!-- END GENERATED cordis-surface -->
