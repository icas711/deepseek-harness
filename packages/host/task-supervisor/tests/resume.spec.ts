// Unit tests for the resume seams: the station world setup refuses to build
// without the stations bridge and mounts the station's fs/subprocess providers
// on private isolate labels inside the agent scope, invisible from the root.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { StationFileSystem } from '@deepseek-ai/dsh-fs-station'
import { StationId } from '@deepseek-ai/dsh-station-protocol'
import { StationSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-station'
import { stationWorldSetup } from '../src/resume.ts'
import { TaskSupervisorError } from '../src/task-error.ts'

/** The runtime service store, read for the mounted provider impls. */
interface StoreImpl { name: string; value: unknown }

function storeOf(ctx: Context): Record<symbol, StoreImpl | undefined> {
  return (ctx as unknown as { reflect: { store: Record<symbol, StoreImpl | undefined> } }).reflect.store
}

describe('stationWorldSetup', () => {
  it('refuses to build a station world without the stations bridge', () => {
    // A station-bound task resumed without the bridge would silently run its
    // tools on the local machine — the loud refusal is the contract.
    expect(() => stationWorldSetup(new Context(), StationId('stn-1'))).toThrow(TaskSupervisorError)
    try {
      stationWorldSetup(new Context(), StationId('stn-1'))
    } catch (error) {
      expect((error as TaskSupervisorError).code).toBe('resume-unavailable')
    }
  })

  it('mounts the station fs/subprocess providers on private isolate labels', async () => {
    const ctx = new Context()
    ctx.provide('stations', {} as never)
    const setup = stationWorldSetup(ctx, StationId('stn-1'))
    const agentCtx = ctx.extend({})
    await setup(agentCtx)
    const store = storeOf(ctx)
    const impls = Object.getOwnPropertySymbols(store)
      .map(symbol => store[symbol])
      .filter((impl): impl is StoreImpl => impl !== undefined)
    const fs = impls.find(impl => impl.name === 'fs')
    const subprocess = impls.find(impl => impl.name === 'subprocess')
    expect(fs?.value).toBeInstanceOf(StationFileSystem)
    expect(subprocess?.value).toBeInstanceOf(StationSubprocessRuntime)
    // Private labels: the root scope still resolves neither provider, and a
    // second station mount gets its own labels instead of colliding.
    expect(ctx.get('fs')).toBeUndefined()
    expect(ctx.get('subprocess')).toBeUndefined()
    // The providers live in the agent scope: their fibers hang below it.
    interface FiberLike {
      parent: { fiber: FiberLike }
    }
    const agentFiber = (agentCtx as unknown as { fiber: FiberLike }).fiber
    for (const impl of [fs, subprocess]) {
      let fiber: FiberLike = (impl?.value as { ctx: { fiber: FiberLike } }).ctx.fiber
      let within = false
      for (let depth = 0; depth < 16; depth += 1) {
        if (fiber === agentFiber) {
          within = true
          break
        }
        fiber = fiber.parent.fiber
      }
      expect(within).toBe(true)
    }
  })
})
