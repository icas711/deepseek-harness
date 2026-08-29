/**
 * Quota-pause guard: parks an agent's proposed work while its provider
 * refuses requests for an exhausted account quota, and releases the parked
 * work on `resume` — the host side of the conversation's "continue after the
 * limit reset" control.
 *
 * Parking is durable by construction: the refused turn's claimed input is
 * re-spliced into the agent's inbox (an `agent/inbox/spliced` append), so it
 * survives process restarts, and a session adopted over a log whose last
 * turn ended in a quota refusal starts parked instead of re-failing. The
 * release spends the parked input without re-surfacing it — its surface copy
 * already exists in the refused turn — through the `agent/pre-step` `resume`
 * decision.
 *
 * @module @deepseek-ai/dsh-quota-pause
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { LlmError, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'

/** Reject unknown keys before defaults can hide them (no settings are supported). */
function validateConfigKeys(config: QuotaPauseConfig): void {
  for (const key of Object.keys(config)) {
    throw new Error(`QuotaPauseConfig: unknown key "${key}" (no settings are supported)`)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    quotaPause: QuotaPause
  }
}

/** Per-agent pause state; dies with the agent, rebuilt from the log on adoption. */
interface PauseState {
  /** Parks every proposed step until {@link QuotaPause.resume} clears it. */
  paused: boolean
  /** The current turn's claimed batch, re-spliced when a quota refusal parks it. */
  claimed: UserMessage[]
  claimedTurn: number
  /**
   * Message ids whose surface copy already exists: consumed without
   * re-surfacing by the armed resume decisions. Inert for ids that never
   * appear in a claim again.
   */
  resumeArmed: Set<string> | undefined
}

/**
 * The seq window of the log's last quota-refused turn, when parking is what
 * followed it. `user/message` events inside the window are the surface
 * copies of the input parking re-spliced. Turns the parking itself closed
 * (`blocked`) are skipped: they are this guard's own artifacts, not the
 * state of the provider account.
 * @param events - the complete session log.
 * @returns the refused turn's `[startSeq, endSeq]`, or undefined when the log
 * does not end in parking over a quota-refused turn.
 */
export function quotaRefusedWindow(events: readonly SessionEvent[]): readonly [number, number] | undefined {
  let end: number | undefined
  let turn: number | undefined
  for (const event of events.toReversed()) {
    if (end === undefined) {
      // Later non-turn events (inbox splices from parking) precede the turn's
      // own end; skip them until the last closed turn is found.
      if (event.type !== 'turn/end') continue
      if (event.data.reason.kind === 'blocked') continue
      const reason = event.data.reason
      if (reason.kind !== 'error' || reason.error.code !== QUOTA_EXCEEDED_CODE) return undefined
      end = event.seq
      turn = event.data.turn
      continue
    }
    if (event.type === 'turn/start' && event.data.turn === turn) return [event.seq, end]
  }
  /* v8 ignore next -- a turn/end without its matching turn/start cannot be appended: the loop writes the pair. */
  return undefined
}

/**
 * Whether one agent's log ends in a quota-refused turn with parked input.
 * @param agent - the agent whose log is inspected.
 * @returns true when {@link QuotaPause.resume} has work to release.
 */
export function hasParkedQuotaWork(agent: Agent): boolean {
  const window = quotaRefusedWindow(agent.session.events)
  return window !== undefined && agent.inbox.hasPending
}

/** Collect the surface message ids of the last quota-refused turn. */
function armedIds(agent: Agent): Set<string> | undefined {
  const window = quotaRefusedWindow(agent.session.events)
  if (window === undefined) return undefined
  const [start, end] = window
  const ids = new Set<string>()
  for (const event of agent.session.events) {
    if (event.seq <= start) continue
    if (event.seq >= end) break
    if (event.type === 'user/message') ids.add(event.data.id)
  }
  return ids
}

/**
 * No configuration keys exist; Schemastery preserves untrusted loader keys on
 * an empty object schema, so the public type excludes settings while
 * `validateConfigKeys` rejects them at load.
 */
export interface QuotaPauseConfig {}

/**
 * The quota-pause service. One host-plane instance watches every agent; the
 * web "continue" control reaches it through the API gateway.
 */
export class QuotaPause extends Service {
  static Config: z<QuotaPauseConfig> = z.object({})

  private readonly states = new WeakMap<Agent, PauseState>()

  constructor(ctx: Context, config: QuotaPauseConfig = {}) {
    super(ctx, 'quotaPause')
    validateConfigKeys(config)

    // Adoption rebuilds the pause from the log: a session whose last turn
    // died on quota starts parked rather than re-failing on its next wake.
    // The state itself must exist from creation so claim tracking sees the
    // whole turn that a refusal later parks.
    ctx.on('agent/created', ({ agent }) => {
      const state = this.stateOf(agent)
      if (hasParkedQuotaWork(agent)) state.paused = true
    })

    // Track each turn's claimed batch so a refusal can re-splice exactly the
    // input the refused turn took.
    ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
      const state = this.states.get(agent)
      if (state === undefined) return
      if (state.claimedTurn !== turn) {
        state.claimedTurn = turn
        state.claimed = []
      }
      state.claimed.push(message)
    })

    // The refusal itself: park the turn's input and hold every later
    // proposal until resume.
    ctx.on('agent/error', ({ agent, error }) => {
      if (!(error instanceof LlmError) || error.code !== QUOTA_EXCEEDED_CODE) return
      const state = this.stateOf(agent)
      state.paused = true
      if (state.claimed.length > 0) {
        agent.inbox.splice('next-turn', 0, 0, state.claimed)
        state.claimed = []
      }
    })

    ctx.on('agent/pre-step', ({ agent, messages }, next): Promise<PreStepDecision> => {
      const state = this.states.get(agent)
      if (state === undefined) return next()
      if (state.paused) {
        // Park: the batch goes back verbatim, in claim order, and the turn
        // closes blocked without spending a model call.
        agent.inbox.splice('next-turn', 0, 0, messages)
        return Promise.resolve({ kind: 'reject' })
      }
      const armed = state.resumeArmed
      if (armed === undefined || !messages.some(message => armed.has(message.id))) return next()
      // Release: surface only input the log has never recorded; the parked
      // remainder is consumed silently by the resume path.
      const fresh = messages.filter(message => !armed.has(message.id))
      return Promise.resolve(fresh.length > 0 ? { kind: 'enter', messages: fresh } : { kind: 'resume' })
    })
  }

  /**
   * Whether the agent currently parks proposed work on its provider's quota
   * refusal.
   * @param agent - the agent to inspect.
   * @returns true while proposed steps are parked.
   */
  isPaused(agent: Agent): boolean {
    return this.states.get(agent)?.paused ?? false
  }

  /**
   * Release parked work: arm the resume decision with the refused turn's
   * surface ids, clear the pause, and wake the driver for the pending batch.
   * A provider still over its limit fails the released turn, which parks
   * again — the control stays honest without probing the provider.
   * @param agent - the agent whose parked work is released.
   * @returns whether the log had a quota-refused turn with input to release.
   */
  resume(agent: Agent): boolean {
    const ids = armedIds(agent)
    if (ids === undefined) return false
    const state = this.stateOf(agent)
    state.resumeArmed = ids
    state.paused = false
    agent.wake()
    return true
  }

  private stateOf(agent: Agent): PauseState {
    let state = this.states.get(agent)
    if (state === undefined) {
      state = { paused: false, claimed: [], claimedTurn: 0, resumeArmed: undefined }
      this.states.set(agent, state)
    }
    return state
  }
}

export default QuotaPause
