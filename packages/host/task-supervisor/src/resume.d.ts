/**
 * Cold-session resume and the model-visible continuation input, following the
 * api-proxy resume policy: reuse the live agent, otherwise reopen the session
 * from persistence (composing the preset its history was produced under) and
 * deliver the continuation as ordinary logged user input.
 * @module @deepseek-ai/dsh-task-supervisor/resume
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent, AgentHandle, AgentSetup } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { StationId } from '@deepseek-ai/dsh-station-protocol';
import type { SessionId } from '@deepseek-ai/dsh-session';
/**
 * Model-visible continuation text for a task the supervisor parked or found
 * interrupted after a restart. A pinned literal: the package snapshot test
 * owns this exact string, and every resume delivers it verbatim.
 */
export declare const CONTINUATION_PROMPT: string;
/**
 * Model-visible continuation text for a task whose bound station reconnected:
 * the resume keeps the work on that station, so the input names the return,
 * not a server restart. Pinned literal, same rules as {@link CONTINUATION_PROMPT}.
 */
export declare const STATION_CONTINUATION_PROMPT = "\u0421\u0432\u044F\u0437\u044C \u0441\u043E \u0441\u0442\u0430\u043D\u0446\u0438\u0435\u0439 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0430. \u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 \u0437\u0430\u0434\u0430\u0447\u0438 \u0441 \u043C\u0435\u0441\u0442\u0430 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0438.";
/**
 * Build the continuation message. The `plugin` source keeps this ordinary
 * logged `user/message` input — no new session event type — while naming the
 * producer in the durable log.
 * @returns a frozen user message carrying {@link CONTINUATION_PROMPT}.
 */
export declare function buildContinuationMessage(): UserMessage;
/**
 * Build the station-return continuation message — the same ordinary logged
 * input path as {@link buildContinuationMessage}, with the station wording.
 * @returns a frozen user message carrying {@link STATION_CONTINUATION_PROMPT}.
 */
export declare function buildStationContinuationMessage(): UserMessage;
/**
 * The agent-scope setup that mounts one station's execution world: the
 * fs-station and subprocess-station providers replace the local world for
 * everything composed inside the returned scope. Each mount gets a private
 * `isolate` label — two sessions bound to different stations must not
 * collide on the shared service store, and an unlabeled registration would
 * throw against the host's own `fs`/`subprocess` providers (the
 * preset/isolate mechanic).
 *
 * The same two-line mount lives in `dsh-host-apiproxy`'s session-create
 * path; it is kept local to each consumer because the alternative — a helper
 * in `dsh-stations` — would make the provider packages depend on the bridge
 * that depends on them.
 * @param ctx - context that may carry the stations bridge.
 * @param stationId - the station whose world the setup mounts.
 * @returns the setup callback for the agent factory.
 * @throws {@link TaskSupervisorError} with `resume-unavailable` when the
 * composition mounts no stations bridge: a station-bound task resumed
 * silently onto the local world would run tools on the wrong machine.
 */
export declare function stationWorldSetup(ctx: Context, stationId: StationId): AgentSetup;
/** The agent a resume resolved, plus the handle only a cold open produced. */
export interface ResumedAgent {
    /** The live agent to deliver work to. */
    readonly agent: Agent;
    /** Ownership handle when this call resumed the session from persistence. */
    readonly owned: AgentHandle | undefined;
}
/**
 * Resolve one session identity to a live agent, reusing any attached agent
 * and otherwise resuming it from the durable session store. A cold open
 * composes the session's recorded agent preset when a roster is mounted —
 * the history was produced under that composition, and rebuilding it
 * differently would replay tool calls the agent can no longer make. A
 * station-bound task additionally remounts that station's execution world in
 * the agent scope ({@link stationWorldSetup}); a live reuse keeps the world
 * its creation mounted.
 * @param ctx - context carrying the agent registry and optional persistence,
 * preset roster, stations bridge, and default-model services.
 * @param sessionId - the persisted session to open.
 * @param stationId - the task's station binding, when any.
 * @returns the live agent and, for a cold open, its owned handle.
 * @throws {@link TaskSupervisorError} with `resume-unavailable` when the
 * agent registry, a persistence backend, or the stations bridge required by
 * the binding is absent, or `session-not-found` when the store does not list
 * the identity.
 */
export declare function openSessionAgent(ctx: Context, sessionId: SessionId, stationId?: StationId): Promise<ResumedAgent>;
//# sourceMappingURL=resume.d.ts.map