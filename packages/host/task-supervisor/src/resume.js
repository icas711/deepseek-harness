/**
 * Cold-session resume and the model-visible continuation input, following the
 * api-proxy resume policy: reuse the live agent, otherwise reopen the session
 * from persistence (composing the preset its history was produced under) and
 * deliver the continuation as ordinary logged user input.
 * @module @deepseek-ai/dsh-task-supervisor/resume
 */
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { StationFileSystem } from '@deepseek-ai/dsh-fs-station';
import { StationSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-station';
import { TaskSupervisorError } from "./task-error.js";
/**
 * Model-visible continuation text for a task the supervisor parked or found
 * interrupted after a restart. A pinned literal: the package snapshot test
 * owns this exact string, and every resume delivers it verbatim.
 */
export const CONTINUATION_PROMPT = 'Задача была прервана рестартом сервера. Продолжи выполнение с места остановки; '
    + 'сначала кратко восстанови контекст по истории.';
/**
 * Model-visible continuation text for a task whose bound station reconnected:
 * the resume keeps the work on that station, so the input names the return,
 * not a server restart. Pinned literal, same rules as {@link CONTINUATION_PROMPT}.
 */
export const STATION_CONTINUATION_PROMPT = 'Связь со станцией восстановлена. Продолжи выполнение задачи с места остановки.';
/**
 * Build the continuation message. The `plugin` source keeps this ordinary
 * logged `user/message` input — no new session event type — while naming the
 * producer in the durable log.
 * @returns a frozen user message carrying {@link CONTINUATION_PROMPT}.
 */
export function buildContinuationMessage() {
    return createUserMessage({
        content: [{ type: 'text', text: CONTINUATION_PROMPT }],
        source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-task-supervisor' },
    });
}
/**
 * Build the station-return continuation message — the same ordinary logged
 * input path as {@link buildContinuationMessage}, with the station wording.
 * @returns a frozen user message carrying {@link STATION_CONTINUATION_PROMPT}.
 */
export function buildStationContinuationMessage() {
    return createUserMessage({
        content: [{ type: 'text', text: STATION_CONTINUATION_PROMPT }],
        source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-task-supervisor' },
    });
}
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
export function stationWorldSetup(ctx, stationId) {
    if (ctx.get('stations') === undefined) {
        throw new TaskSupervisorError('resuming a station-bound task requires the stations bridge (load @deepseek-ai/dsh-stations)', 'resume-unavailable');
    }
    return async (agentCtx) => {
        await agentCtx.isolate('fs').plugin(StationFileSystem, { stationId });
        await agentCtx.isolate('subprocess').plugin(StationSubprocessRuntime, { stationId });
    };
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
export async function openSessionAgent(ctx, sessionId, stationId) {
    // Strict global reads, not the property proxy: the registry and the other
    // seams here are optional composition, never declared injections.
    const registry = ctx.get('agents');
    const live = registry?.get(sessionId);
    if (live !== undefined)
        return { agent: live, owned: undefined };
    if (registry === undefined) {
        throw new TaskSupervisorError('resuming a parked task requires the agent registry (load @deepseek-ai/dsh-agent)', 'resume-unavailable');
    }
    const persistence = ctx.get('sessionPersistence');
    if (persistence === undefined) {
        throw new TaskSupervisorError('resuming a parked task requires a session persistence backend (load a dsh-session-persistence provider)', 'resume-unavailable');
    }
    const stored = (await persistence.list()).find(header => header.id === sessionId);
    if (stored === undefined) {
        throw new TaskSupervisorError(`session "${sessionId}" is not in the durable session store`, 'session-not-found');
    }
    const steps = [];
    const presets = ctx.get('agentPresets');
    if (presets !== undefined) {
        const inspected = await persistence.inspect(sessionId);
        // Resolved from the LOG, not the header: a session that switched while
        // blank ran its turns under the newer composition.
        const presetId = (await presets.resolve(resolveSessionPreset({ header: inspected.meta, events: inspected.events }))).id;
        steps.push(async (agentCtx) => {
            await presets.mount(agentCtx, presetId);
        });
    }
    if (stationId !== undefined)
        steps.push(stationWorldSetup(ctx, stationId));
    const setup = steps.length === 0 ? undefined : async (agentCtx) => {
        for (const step of steps)
            await step(agentCtx);
    };
    const defaults = ctx.get('agentDefaultModel');
    const owned = await registry.resume({
        resumeSessionId: sessionId,
        ...(defaults === undefined ? {} : { agentOptions: defaults.currentSelection() }),
        ...(setup === undefined ? {} : { setup }),
    });
    return { agent: owned.agent, owned };
}
//# sourceMappingURL=resume.js.map