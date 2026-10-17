/**
 * Cold-session resume and the model-visible continuation input, following the
 * api-proxy resume policy: reuse the live agent, otherwise reopen the session
 * from persistence (composing the preset its history was produced under) and
 * deliver the continuation as ordinary logged user input.
 * @module @deepseek-ai/dsh-task-supervisor/resume
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentSetup } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { TaskSupervisorError } from './task-error.ts'

/**
 * Model-visible continuation text for a task the supervisor parked or found
 * interrupted after a restart. A pinned literal: the package snapshot test
 * owns this exact string, and every resume delivers it verbatim.
 */
export const CONTINUATION_PROMPT
  = 'Задача была прервана рестартом сервера. Продолжи выполнение с места остановки; '
  + 'сначала кратко восстанови контекст по истории.'

/**
 * Build the continuation message. The `plugin` source keeps this ordinary
 * logged `user/message` input — no new session event type — while naming the
 * producer in the durable log.
 * @returns a frozen user message carrying {@link CONTINUATION_PROMPT}.
 */
export function buildContinuationMessage(): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: CONTINUATION_PROMPT }],
    source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-task-supervisor' },
  })
}

/** The agent a resume resolved, plus the handle only a cold open produced. */
export interface ResumedAgent {
  /** The live agent to deliver work to. */
  readonly agent: Agent
  /** Ownership handle when this call resumed the session from persistence. */
  readonly owned: AgentHandle | undefined
}

/**
 * Resolve one session identity to a live agent, reusing any attached agent
 * and otherwise resuming it from the durable session store. A cold open
 * composes the session's recorded agent preset when a roster is mounted —
 * the history was produced under that composition, and rebuilding it
 * differently would replay tool calls the agent can no longer make.
 * @param ctx - context carrying the agent registry and optional persistence,
 * preset roster, and default-model services.
 * @param sessionId - the persisted session to open.
 * @returns the live agent and, for a cold open, its owned handle.
 * @throws {@link TaskSupervisorError} with `resume-unavailable` when the
 * agent registry or a persistence backend is absent, or `session-not-found`
 * when the store does not list the identity.
 */
export async function openSessionAgent(ctx: Context, sessionId: SessionId): Promise<ResumedAgent> {
  // Strict global reads, not the property proxy: the registry and the other
  // seams here are optional composition, never declared injections.
  const registry = ctx.get('agents')
  const live = registry?.get(sessionId)
  if (live !== undefined) return { agent: live, owned: undefined }
  if (registry === undefined) {
    throw new TaskSupervisorError('resuming a parked task requires the agent registry (load @deepseek-ai/dsh-agent)', 'resume-unavailable')
  }
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) {
    throw new TaskSupervisorError(
      'resuming a parked task requires a session persistence backend (load a dsh-session-persistence provider)',
      'resume-unavailable',
    )
  }
  const stored = (await persistence.list()).find(header => header.id === sessionId)
  if (stored === undefined) {
    throw new TaskSupervisorError(`session "${sessionId}" is not in the durable session store`, 'session-not-found')
  }
  const presets = ctx.get('agentPresets')
  let setup: AgentSetup | undefined
  if (presets !== undefined) {
    const inspected = await persistence.inspect(sessionId)
    // Resolved from the LOG, not the header: a session that switched while
    // blank ran its turns under the newer composition.
    const presetId = (await presets.resolve(resolveSessionPreset({ header: inspected.meta, events: inspected.events }))).id
    setup = async (agentCtx: Context) => {
      await presets.mount(agentCtx, presetId)
    }
  }
  const defaults = ctx.get('agentDefaultModel')
  const owned = await registry.resume({
    resumeSessionId: sessionId,
    ...(defaults === undefined ? {} : { agentOptions: defaults.currentSelection() }),
    ...(setup === undefined ? {} : { setup }),
  })
  return { agent: owned.agent, owned }
}
