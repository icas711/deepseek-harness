/**
 * Settings-backed mode switching: the `session-telemetry` section overrides
 * the composition entry live through the real settings seam, each change
 * swaps the whole capture pipeline, and a provider detach falls back to the
 * entry mode. Assertions run against the REAL OTel export path (mock
 * collector), not doubles of the SDK pipeline. Exports are driven by the
 * batch processor's cadence (`scheduledDelayMillis: 20`), never by mid-test
 * `shutdown()` — the SDK's provider shutdown is terminal, exactly like the
 * service-dispose path it models.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { recordFeedback } from '@deepseek-ai/dsh-command-feedback'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import OpenTelemetrySessionBackend, {
  SessionTelemetryMode,
  TELEMETRY_SETTINGS_NS,
} from '../src/index.ts'
import { closeCollectors, mockCollector, type Capture } from './collector.ts'

let tempHome: string | undefined

afterEach(async () => {
  await closeCollectors()
  if (tempHome !== undefined) {
    rmSync(tempHome, { recursive: true, force: true })
    delete process.env.DSH_HOME
    tempHome = undefined
  }
})

function home(): string {
  tempHome = mkdtempSync(join(tmpdir(), 'dsh-otel-settings-'))
  process.env.DSH_HOME = tempHome
  return tempHome
}

/** Boot the real dynamic composition: session store, settings file, backend. */
async function boot(dir: string, entry: object, collectorUrl: string) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const settingsFiber = await ctx.plugin(
    FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false },
  )
  const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
    exporter: { url: collectorUrl },
    // A fast cadence keeps export waits in tests bounded without shutdown().
    processor: { scheduledDelayMillis: 20 },
    ...entry,
  })
  return { ctx, fiber, settingsFiber }
}

function liveSession(ctx: Context, id: string): Session {
  const session = ctx.sessions.create(SessionId(id), { meta: {} })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `hello ${id}` }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  return session
}

/** Wait until the exported bodies, joined, contain `text`. */
async function waitForExport(captures: Capture[], text: string): Promise<void> {
  await vi.waitFor(() => {
    expect(JSON.stringify(captures.map(capture => capture.body))).toContain(text)
  }, { timeout: 5000 })
}

describe('session-telemetry-otel settings-backed mode', () => {
  it('switches capture on and off live through the settings section', async () => {
    const dir = home()
    const { url, captures } = await mockCollector()
    const { ctx, fiber } = await boot(dir, { mode: SessionTelemetryMode.DISABLED }, url)
    expect(ctx.sessionTelemetry.sharing).toBe('disabled')

    // Live events under DISABLED never leave the process.
    liveSession(ctx, 'before-enable')
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(captures).toEqual([])

    // The stored section flips the mode; the next live event exports.
    await ctx.settings.update(TELEMETRY_SETTINGS_NS, { mode: SessionTelemetryMode.FULL })
    expect(ctx.sessionTelemetry.sharing).toBe('full')
    liveSession(ctx, 'after-enable')
    await waitForExport(captures, 'after-enable')

    // Flipping back stops export: a further event's content never reaches
    // the collector. The swap itself closes the superseded pipeline, whose
    // coordinator emits the seam's dispose-time shutdown markers — those are
    // the incarnation boundary, not session content.
    await ctx.settings.update(TELEMETRY_SETTINGS_NS, { mode: SessionTelemetryMode.DISABLED })
    expect(ctx.sessionTelemetry.sharing).toBe('disabled')
    liveSession(ctx, 'after-disable')
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(JSON.stringify(captures.map(capture => capture.body))).not.toContain('after-disable')
    await fiber.dispose()
  })

  it('rebuilds live capture without re-exporting already-handed-off records', async () => {
    const dir = home()
    const { url, captures } = await mockCollector()
    const { ctx, fiber } = await boot(dir, { mode: SessionTelemetryMode.FULL }, url)

    const session = liveSession(ctx, 'cursor-session')
    await waitForExport(captures, 'hello cursor-session')

    // A round trip through DISABLED and back must not re-hand the same seqs:
    // the module handoff cursor survives the pipeline swap.
    await ctx.settings.update(TELEMETRY_SETTINGS_NS, { mode: SessionTelemetryMode.DISABLED })
    await ctx.settings.update(TELEMETRY_SETTINGS_NS, { mode: SessionTelemetryMode.FULL })
    session.append('turn/start', { turn: 2 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'second turn' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await waitForExport(captures, 'second turn')

    // The first turn's user text appears exactly once across every export:
    // no incarnation re-handed the events the first one already delivered.
    expect(JSON.stringify(captures.map(capture => capture.body)).match(/hello cursor-session/g))
      .toHaveLength(1)
    await fiber.dispose()
  })

  it('refuses a settings write that names an uploading mode without a usable transport', async () => {
    const dir = home()
    // No exporter anywhere: the entry cannot support an uploading mode.
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
    await ctx.plugin(OpenTelemetrySessionBackend, { mode: SessionTelemetryMode.DISABLED })

    await expect(
      ctx.settings.update(TELEMETRY_SETTINGS_NS, { mode: SessionTelemetryMode.FULL }),
    ).rejects.toThrow(/exporter\.url is required/)
    expect(ctx.sessionTelemetry.sharing).toBe('disabled')
    await ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const dir = home()
    const { url } = await mockCollector()
    const { ctx, settingsFiber } = await boot(dir, { mode: SessionTelemetryMode.FEEDBACK_ONLY }, url)

    await ctx.settings.update(TELEMETRY_SETTINGS_NS, { mode: SessionTelemetryMode.DISABLED })
    expect(ctx.sessionTelemetry.sharing).toBe('disabled')

    // Detaching the settings provider removes the override source; the entry
    // mode stands again.
    await settingsFiber.dispose()
    expect(ctx.sessionTelemetry.sharing).toBe('feedback-only')
    await ctx.fiber.dispose()
  })

  it('keeps feedback-only semantics: ordinary events stay local, consented feedback exports', async () => {
    const dir = home()
    const { url, captures } = await mockCollector()
    const { ctx, fiber } = await boot(dir, { mode: SessionTelemetryMode.FEEDBACK_ONLY }, url)

    // Under FEEDBACK_ONLY ordinary events stay local.
    const session = liveSession(ctx, 'gated')
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(captures).toEqual([])

    // Recorded feedback is the one consented export, and it rides the
    // on-demand canonical-log capture.
    recordFeedback(session, 'helpful')
    await waitForExport(captures, 'gated')
    await fiber.dispose()
  })
})
