# Agent Note: Quota pause and live telemetry mode

Status: implemented

English | [中文](2026-08-16-quota-pause-and-live-telemetry-mode.zh.md)

## Problem

A Z.ai GLM session dies at the account usage limit (`429 code 1308 "Usage limit reached for 5 hour. Your limit will reset at …"`): the turn ends in a terminal error, the claimed input is consumed, and the only recovery is retyping the prompt after the limit resets. Telemetry mode was equally frozen: `session-telemetry-otel` read `mode` once at plugin construction, so changing the sharing policy required a process restart, and the General settings row had no host RPC to read the disclosure from.

## Decision

**Park, don't drop** (`packages/guard/quota-pause`, new). A quota refusal is an account state, not a request failure: retrying inside the turn is pointless, and discarding the input is data loss. The guard re-splices the refused turn's claimed batch (tracked through `agent/inbox/claimed`) into the durable inbox and rejects later proposals (`blocked` turn, no model call). Parking rides the inbox's own durability — a restarted host over the same log replays the input pending, and `agent/created` adoption sees the log end in a quota refusal and starts the agent parked instead of re-failing.

**Release through the recorded log** (`packages/core/agent`, `agent-loop`). Re-sending the parked text as a fresh user message would duplicate the surface — the refused turn already recorded its `user/message` copy. `PreStepDecision` gains `{ kind: 'resume' }`: an enter over the recorded log that spends the claim with no new surface appends. The armed decision is keyed to the refused turn's `user/message` ids, so input typed while parked still surfaces alongside the silent parked batch. The release is honest without probing the provider: a still-exhausted account refuses the released turn, which re-parks. `Agent.wake()` (added in the same arc) releases parked work without new input; the web conversation's QUOTA turn-error row offers the Continue control through the `session.resumeAfterQuota` RPC, which resolves cold sessions through the same agent machinery a prompt uses.

**Mode as layered settings** (`packages/session/session-telemetry-otel`). The backend rebuilds its whole capture pipeline (coordinator listeners plus SDK provider, each on a disposable child fiber) when the `session-telemetry` section's `mode` changes; the module handoff cursor keeps a rebuild from re-exporting records the previous incarnation handed off. The composition entry is the base layer; a settings-provider detach falls back to it. `host.telemetryStatus` discloses `{sharing, configuredMode, changeable}` in one call, and the write path is the ordinary settings update — no parallel mutation surface. The `session-telemetry` namespace joins the web-exposed settings list, and the General row (`packages/client/ui-telemetry-status`, new) renders the disclosure with a mode selector where `changeable`.

**Route naming** (`packages/llm/llm-zai`, now mounted in the base bundle). pi-ai's installed catalog owns the bare `zai` configurable-provider route for its own adapter family; the native adapter registers `zai-official`, mirroring `deepseek-official`, so both families compose without a duplicate-directory throw.

## Alternatives considered

**Re-send the parked input as a fresh user message on release.** Rejected because it duplicates the surface copy the refused turn already recorded: the resumed request would carry the prompt twice, and derived history would show the same text as two user turns.

**Retry the refused request on a timer until the limit resets.** Rejected because an automatic timer that fires while the account is still limited burns a request and re-parks in a loop; the Continue control is the release verb precisely because the user knows when the limit reset.

**A durable "paused" marker event.** Rejected as redundant: the refused `turn/end` plus the parking `agent/inbox/spliced` append already encode the state, and adoption derives parking from them. A marker would add a third event to keep consistent.

**Probe the provider before arming the release.** Rejected because correctness does not need it — the released turn failing again re-parks — and a probe would spend a request against the very quota the pause protects.

## Consequences

A quota-refused session keeps its input and offers an explicit continuation; the released request runs over the log exactly as the refused turn left it, with the parked prompt surfaced exactly once. Mode changes apply without a restart, and the settings seam — with its revision conflicts, validation, and last-good-value behavior — is the only write path. Cost: the pause is per-agent live state (WeakMap) rebuilt from the log at adoption rather than a persisted mode; a log normalized by a clean shutdown has no parked work to release, which is correct because that shutdown's inbox cancellation is itself a user-visible drop. The `resume` decision is now part of the pre-step contract, so every `agent/pre-step` listener that reads `decision.messages` must treat a non-`enter` decision as pass-through (all shipped listeners were updated with the loop's own test pinning the semantics). GLM models are selectable as `zai-official` next to the pi-ai catalog's dormant `zai` entries.

## Verification

- `packages/core/agent-loop/tests/interception.spec.ts` — the resume decision runs the model over the recorded log with the input surfaced exactly once.
- `packages/guard/quota-pause/tests/quota-pause.spec.ts` — park/hold, release without re-surface, mixed fresh-plus-parked input, re-park on a still-exhausted provider, adoption-parked over a persisted refused log.
- `packages/session/session-telemetry-otel/tests/settings-mode.spec.ts` — live mode swaps against a real OTLP mock collector, cursor survival across a rebuild, write refusal without a usable exporter, detach fallback.
- `packages/host/apiproxy/tests/client-handler.spec.ts` — both new RPCs through the wire schemas, including the closed-vocabulary fence.
- `packages/client/ui-telemetry-status/tests/*` — disclosure, mode write, refusal rendering; `packages/client/ui-conversation/tests/chat-view.client.spec.tsx` — the quota Continue control (offer, retire on a later closed turn, absent for other failure codes).
