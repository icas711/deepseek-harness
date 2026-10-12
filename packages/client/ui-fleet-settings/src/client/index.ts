/**
 * Fleet limits surface plugin, browser half: registers the General settings
 * row editing the `fleet` settings namespace — the per-fanout attempt cap and
 * the delegation-depth ceiling the fleet service enforces live — refreshing
 * it on settings edits from any surface.
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
import { FleetLimitsRow } from './FleetLimitsRow.tsx'
import type { FleetLimitsRowInjected } from './FleetLimitsRow.tsx'
import { FLEET_SETTINGS_NS, FleetLimitsController } from './store.ts'

export type { FleetLimitsRowProps, FleetLimitsRowInjected } from './FleetLimitsRow.tsx'
export type { FleetLimitsKey } from './locales.ts'
export type { FleetLimitsState, FleetLimitsValue } from './store.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'fleetLimits'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Register the fleet limits row in the General settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, ru), 'ui-fleet-settings: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new FleetLimitsController(connection.api)

  // The limits are settings fields: an external edit (another tab, the
  // document opened on the host) moves the served view, and a reconnect can
  // land on a restarted host with a different composition.
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns: string) => {
        if (ns !== FLEET_SETTINGS_NS) return
        void controller.load()
      }),
      ctx.on('connection/reset', () => { void controller.load() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-fleet-settings: limits refresh')
  ctx.effect(() => () => { controller.dispose() }, 'ui-fleet-settings: controller disposal')

  const injected = (): FleetLimitsRowInjected => ({
    hooks: { fleetLimits: controller.store },
    load: () => controller.load(),
    save: next => controller.save(next),
  })

  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'fleet-limits',
      order: 90, // Above the telemetry row (order 100)
      label: () => ctx.locale.bind(NS)('fleetLimits.label'),
      locale: NS,
      inject: injected,
    }, FleetLimitsRow))
}
