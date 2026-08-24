# Agent Note: Durable Session Deletion

Status: implemented

English | [中文](2026-08-24-durable-session-deletion.zh.md)

## Problem

The Web GUI could archive a session but never delete one. Archiving hides a row without touching its log, so storage grew without bound and a user who wanted a session gone had to remove files under the persistence root out-of-band — invisible to the Workspace registry's accounting and the archive set. Both first-party backends documented "nothing deletes session files" as a known limitation, and the feedback sidecar note recorded that no deletion authority existed to own a truthful cascade.

Deletion is not disposal. `session/disposed` and `host/session-removed` describe detach from live ownership; a deleted session's log must leave persistence, the registry must forget it, and every client must drop the row. Live deletion additionally has to decide who may delete a session whose agent another host surface attached, and what happens to a subagent-fenced identity. The write-behind drain of a just-disposed session races the artifact removal, and the operation must stay idempotent for an id that is already gone.

## Decision

### Persistence owns the removal primitive

`SessionPersistence.delete(id)` is part of the service contract (`ctx.sessionPersistence`). The coordinator rejects while the session is live — the caller disposes it first — then waits for the in-flight retirement's final drain **outside** the per-id serialization chain, because that drain's own tail may still be queued behind the same chain and awaiting it from inside would deadlock. A failed final drain does not block deletion: those events are being discarded anyway, matching the observe-only posture of retirement. The serialized core drops the retained preparation and delegates to the backend's `deleteStored(id)`; an absent id resolves idempotently, freeing the id for later reuse.

- JSONL resolves the one matching session directory across readable project directories (an id spread over two projects is ambiguous durable state and rejects), removes it recursively, and skips a non-directory at the expected path — mirroring what listing ever saw. Sibling sessions and the project directory survive.
- SQLite deletes the `sessions` row; `ON DELETE CASCADE` removes its `events` rows in the same statement.

### The gateway owns the orchestration

The Host RPC `session.delete` composes disposal, artifact removal, and registry forgetting, in that order:

1. A **live** session is deleted by disposing the agent handle this proxy owns (`agentHandles`), so a running turn cancels with the disposal cause. A live session whose agent another host surface attached answers `session-ownership` (a new error code carrying the `sessionId`); a subagent-fenced identity answers `agent-busy` on both the live and cold paths.
2. A **cold** session is inspected without resuming or publishing an agent; an unknown id answers `session-not-found`.
3. After disposal and drain, `persistence.delete` removes the artifact, then `WorkspaceRegistry.forgetSession(sessionId)` drops the header index, archive-set membership, and every workspace's `sessionIds` account — each write durable. Forgetting runs after the log removal and never touches logs itself; it resolves idempotently for an untracked id.
4. A cold deletion pushes one `host/session-removed` host-stream frame after the durable commit. The live path's frame already rides `session/disposed` on the mux stream, so only the cold path mints one. Registry frames (`host/archived-sessions-changed`, `host/workspace-changed`) follow the forget writes.

A composition without persistence answers `internal`, as every other durable operation does.

### The client applies the same teardown locally

`ISessions.delete(sessionId)` resolves after the Host commits and runs the identical teardown the `host/session-removed` frame performs, tagged as the initiator's local echo. Because the initiator knows the deletion is durable, a subagent-origin row removed through the local echo detaches durably: descendant indexes drop it and a same-id re-add cannot reattach — the frame path keeps the previous detach-only posture, since a frame alone does not prove the log was deleted rather than the agent disposed. A refusal rejects as `SessionDeleteError` carrying the wire error; the row stays.

### The UI confirms before destroying

The workspace browser's Session row menu gains a danger-styled **Delete session** item opening a confirmation dialog that names the session and states the deletion is irreversible. Confirming disables both footer actions until the Host resolves; a refusal keeps the dialog open with the error. The browser calls its `deleteSession` slot contribution, which delegates to `ISessions.delete`. Copy ships zh/en/ru.

## Alternatives considered

**Reuse `workspace.archiveSession` with a "purge" flag.** Archiving is registry accounting over a surviving log; folding artifact removal into it would give one RPC two durability meanings and leave the archive set ambiguous about whether a row can return.

**Delete through the Workspace registry only.** The registry owns grouping, not logs; it cannot sequence drain-then-remove against live agents, and a registry-forget of a still-persisted session would resurrect the row on the next bootstrap scan.

**Await the final drain inside the serialization chain.** Deadlocks against the drain's own queued tail. Awaiting outside the chain preserves ordering (the core still serializes) while letting the drain settle first.

**Let a failed final drain fail the deletion.** The drain's events are being discarded by the very deletion waiting on it; failing the RPC would leave an undeletable session whenever a flush error coincided with disposal.

**Cascade the feedback sidecar.** The sidecar is keyed by header identity `{createdAt, cwd}`, which already prevents an orphan from becoming feedback for a reused id, and `session.delete` composes at the gateway where the storage-domain sidecar is not in scope. Rows remain until out-of-band cleanup; see the [message-feedback sidecar note](../architecture/2026-08-10-message-feedback-sidecar.md).

**Push `host/session-removed` on the live path too.** Clients already observe `session/disposed` for a proxy-owned live agent; a second frame would double-tear the same row with no ordering guarantee between the streams.

## Consequences

Deletion is now a first-class durable operation spanning the persistence seam, the Workspace registry, the RPC surface, and the Web UI, where previously each tier documented its absence. What it bought: a user-visible path that actually reclaims storage and keeps registry accounting truthful, an idempotent primitive any future host surface can call, and a `session-ownership` error code that names the multi-surface live-agent rule. Costs: a new wire error code and method, and the rule that the coordinator's deletion waits out (but tolerates the failure of) the disposed session's final drain — a deletion completed means the log is gone, never half-gone. The feedback sidecar deliberately does not cascade; its rows outlive their session until removed out-of-band, documented in its own note and README.

## Testing

The persistence contract suite holds every backend to durable, idempotent deletion with live-refusal and post-detach delete; coordinator tests pin drain-waiting and drain-failure tolerance; JSONL tests pin directory removal, stray-file skipping, and multi-project refusal; SQLite tests pin the row cascade with siblings intact. The gateway suite covers live disposal, `session-ownership`, `agent-busy` on both paths, `session-not-found`, the cold-path frame, backend failure, and persistence-less composition. Workspace tests cover archive-slot forgetting, idempotent ghosts, and restart with the log absent. Runtime tests cover local-echo teardown, subagent durable detach, current-selection clearing, and `SessionDeleteError`; UI tests cover the confirmation dialog copy, duplicate-submission blocking, and failure retry. A keyless web e2e scenario walks the assembled product path — row menu, confirm dialog, row removal, host-side log disappearance, and no resurfacing across reload — reusing the seeded-history fixture with no new recording; `realizeSeedFixture` JSON-escapes the substituted cwd so seeded scenarios replay on Windows as well.
