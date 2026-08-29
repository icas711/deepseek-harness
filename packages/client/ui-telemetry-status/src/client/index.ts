/**
 * Telemetry status surface plugin, browser half: registers the General
 * settings row showing the mounted backend's sharing disclosure, refreshing
 * it on settings edits from any surface, and — where the deployment applies
 * mode changes live — a selector writing the `session-telemetry` section.
 *
 * Export discipline: packages/client/AGENTS.md.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings shell's SlotMap merge (the
// 'settings.general.item' entry this row registers into).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (the settings invalidation rides the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ru } from './locales.ts'
import { TelemetryStatusRow } from './TelemetryStatusRow.tsx'
import type { TelemetryStatusRowInjected } from './TelemetryStatusRow.tsx'
import { TELEMETRY_SETTINGS_NS, TelemetryStatusController } from './store.ts'

export type { TelemetryStatusRowProps, TelemetryStatusRowInjected } from './TelemetryStatusRow.tsx'
export type { TelemetryStatusKey } from './locales.ts'
export type { TelemetryMode, TelemetryStatusState, TelemetryStatusValue } from './store.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'telemetryStatus'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Register the telemetry status row in the General settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, ru), 'ui-telemetry-status: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new TelemetryStatusController(connection.api)

  // The mode is a settings field: an external edit (another tab, the
  // document opened on the host) moves the disclosure, and a reconnect can
  // land on a restarted host with a different composition.
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns: string) => {
        if (ns !== TELEMETRY_SETTINGS_NS) return
        void controller.load()
      }),
      ctx.on('connection/reset', () => { void controller.load() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-telemetry-status: disclosure refresh')

  const injected = (): TelemetryStatusRowInjected => ({
    hooks: { telemetryStatus: controller.store },
    load: () => controller.load(),
    select: mode => controller.select(mode),
  })

  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'telemetry-status',
      order: 100, // Place at bottom of General section
      label: () => ctx.locale.bind(NS)('telemetryStatus.label'),
      locale: NS,
      inject: injected,
    }, TelemetryStatusRow))
}
