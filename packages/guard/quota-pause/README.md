# @deepseek-ai/dsh-quota-pause

Quota-pause guard: when a provider refuses a model request because the account's usage limit is exhausted (Z.ai's `429 1308 "Usage limit reached for 5 hour. Your limit will reset at …"` is the live case), the refused turn's input is parked back into the agent's inbox and later proposals wait instead of re-failing. The web conversation's turn-error row offers a **Continue** control that releases the parked work after the limit resets; a still-exhausted provider refuses the released turn and the work re-parks.

## Composition

Host-plane row (mounted in the `dsh-base` bundle):

```yaml
- id: quota-pause
  name: '@deepseek-ai/dsh-quota-pause'
```

No configuration is supported; unknown keys fail the plugin load.

## Mechanics

- **Park** — an `agent/error` carrying `LlmError` code `QUOTA` re-splices the refused turn's claimed batch (tracked through `agent/inbox/claimed`) to the head of the `next-turn` list and parks the agent: every later `agent/pre-step` proposal is rejected (`blocked` turn, no model call) with its batch re-spliced verbatim.
- **Release** — the host-side `session.resumeAfterQuota` RPC resolves the agent (cold sessions included) and calls `QuotaPause.resume`: the decision arms the refused turn's recorded surface ids, clears the pause, and wakes the driver. The armed `agent/pre-step` decision spends the claim through the loop's `resume` path — the parked input is consumed without a second surface copy, so the request runs over the log exactly as the refused turn left it. Input typed while parked still surfaces.
- **Durability** — parking is an `agent/inbox/spliced` append, so a host restart over the same log replays the parked input pending; `agent/created` adoption sees the log ends in a quota refusal and starts the agent parked rather than re-failing.

## Model Experience

None, as the guard parks and releases agent work through inbox splices and pre-step decisions; a released turn's request history contains the parked input exactly once — the surface copy the refused turn recorded.

#### KV Cache effect

None: the guard adds no prompt, schema, or request field to any model request.

## Known Limitations and Deferred Work

- The pause is per-agent live state over the durable inbox, rebuilt from the log at adoption; a log normalized by a clean shutdown (dispose cancels pending input) has no parked work to release, which is correct — that cancellation is itself a user-visible drop.
- No background re-probe of the provider: the Continue control is the release verb, because an automatic timer firing while the account is still limited would burn a request and re-park in a loop.
