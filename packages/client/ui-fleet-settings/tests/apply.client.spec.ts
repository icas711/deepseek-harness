// @vitest-environment jsdom
/** ui-fleet-settings apply wiring: dictionary registration, the General row
 * entry, the limits refresh triggers, and teardown. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-fleet-settings/client'
import { FleetLimitsRow } from '../src/client/FleetLimitsRow.tsx'
import type { FleetLimitsRowInjected } from '../src/client/FleetLimitsRow.tsx'

const SLOT = 'settings.general.item'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime()
  ctx.provide('locale', locale)
  const describe = vi.fn(() => Promise.resolve({
    rpcId: 'fleet-describe' as never,
    result: {
      ok: true as const,
      value: {
        writable: true,
        hasDocument: true,
        namespaces: [{
          ns: 'fleet',
          schema: {},
          value: { maxMembers: 5, maxFanoutDepth: 2 },
          applies: 'live' as const,
          secrets: [],
          revision: 0,
        }],
      },
    },
  }))
  const update = vi.fn(() => Promise.resolve({
    rpcId: 'fleet-update' as never,
    result: {
      ok: true as const,
      value: {
        ns: 'fleet',
        schema: {},
        value: { maxMembers: 3, maxFanoutDepth: 1 },
        applies: 'live' as const,
        secrets: [],
        revision: 1,
      },
    },
  }))
  ctx.provide('connection', { api: { settings: { describe, update } }, isLoopback: true } as never)
  new TestRemote(ctx)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, describe, update }
}

/** Stand in for the settings shell: declare the General item slot from root. */
function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

/** Bake a real store instance and derive the row's injected face. */
function faceOf(slots: SlotRegistry): FleetLimitsRowInjected {
  const entry = slots.entries(SLOT).find(e => e.component === FleetLimitsRow)!
  return (entry.inject as unknown as () => FleetLimitsRowInjected)()
}

describe('ui-fleet-settings apply', () => {
  it('declares the slot, locale, connection, and remote edges', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote'])
  })

  it('registers localized copy and the row, before or after the declaration', async () => {
    const before = await bench()
    declareItems(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.locale.bind('fleetLimits')('fleetLimits.label')).toBe('Флот')
    const row = before.slots.entries(SLOT)[0]!
    expect(row.options).toMatchObject({ id: 'fleet-limits', order: 90 })
    expect((row.options.label as () => string)()).toBe('Флот')

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries(SLOT)).toHaveLength(0)
    declareItems(after.slots)
    await Promise.resolve()
    expect(after.slots.entries(SLOT).some(e => e.component === FleetLimitsRow)).toBe(true)
  })

  it('loads the fleet namespace through the injected face and refreshes on host signals', async () => {
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = faceOf(b.slots)

    await face.load()
    expect(b.describe).toHaveBeenCalled()
    const snapshot = face.hooks.fleetLimits.getSnapshot()
    expect(snapshot.value).toEqual({ maxMembers: 5, maxFanoutDepth: 2 })

    await face.save({ maxMembers: 3, maxFanoutDepth: 1 })
    expect(b.update).toHaveBeenCalledWith({
      ns: 'fleet',
      patch: { maxMembers: 3, maxFanoutDepth: 1 },
      expectedRevision: 0,
    })
    expect(face.hooks.fleetLimits.getSnapshot().value).toEqual({ maxMembers: 3, maxFanoutDepth: 1 })

    b.describe.mockClear()
    b.ctx.remote.$dispatch('settings/document-updated', ['fleet', 1])
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledOnce() })
    b.describe.mockClear()
    b.ctx.remote.$dispatch('settings/document-updated', ['unrelated', 1])
    await Promise.resolve()
    expect(b.describe).not.toHaveBeenCalled()
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledOnce() })
  })

  it('teardown removes the row, the dictionaries, and the refresh listeners', async () => {
    const b = await bench()
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(SLOT)).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    expect(b.locale.bind('fleetLimits')('fleetLimits.label')).toBe('fleetLimits.label')
    b.describe.mockClear()
    b.ctx.remote.$dispatch('settings/document-updated', ['fleet', 2])
    await Promise.resolve()
    expect(b.describe).not.toHaveBeenCalled()
  })
})
