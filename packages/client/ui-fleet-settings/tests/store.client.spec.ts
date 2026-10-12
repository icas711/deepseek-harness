/**
 * Store behavior over a programmable wire face: the served-view read, the
 * limits write, and how each refusal lands in the snapshot.
 */

import { describe, expect, it, vi } from 'vitest'
import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { RpcId } from '@deepseek-ai/dsh-client-connection/client'
import { FLEET_SETTINGS_NS, FleetLimitsController, limitsOf } from '../src/client/store.ts'

type DescribeFace = IApiClient['settings']['describe']
type UpdateFace = IApiClient['settings']['update']

function okDescribe(value: Awaited<ReturnType<DescribeFace>>['result']) {
  return { rpcId: RpcId('r'), result: value }
}

function okUpdate(value: Awaited<ReturnType<UpdateFace>>['result']) {
  return { rpcId: RpcId('r'), result: value }
}

const VIEW: SettingsNamespaceView = {
  ns: FLEET_SETTINGS_NS,
  schema: {},
  value: { maxMembers: 5, maxFanoutDepth: 2 },
  revision: 3,
  applies: 'live',
  secrets: [],
} as unknown as SettingsNamespaceView

function wire(describe: DescribeFace, update: UpdateFace = () => Promise.resolve(okUpdate({ ok: true, value: VIEW }))): IApiClient {
  return { settings: { describe, update } } as unknown as IApiClient
}

const SERVED = (view: SettingsNamespaceView | undefined, writable = true) => okDescribe({
  ok: true as const,
  value: {
    writable,
    hasDocument: true,
    namespaces: view === undefined ? [] : [view],
  },
})

describe('FleetLimitsController.load', () => {
  it('lands the served limits in the snapshot', async () => {
    const read = vi.fn(() => Promise.resolve(SERVED(VIEW)))
    const controller = new FleetLimitsController(wire(read))

    await controller.load()

    expect(read).toHaveBeenCalledWith({})
    expect(controller.store.getSnapshot()).toEqual({
      status: 'ready',
      error: null,
      value: { maxMembers: 5, maxFanoutDepth: 2 },
      writable: true,
    })
  })

  it('renders a composition without the fleet namespace as unavailable, not failed', async () => {
    const controller = new FleetLimitsController(wire(() => Promise.resolve(SERVED(undefined))))

    await controller.load()

    expect(controller.store.getSnapshot()).toEqual({
      status: 'unavailable',
      error: null,
      value: null,
      writable: false,
    })
  })

  it('keeps the refusal message for other host errors', async () => {
    const controller = new FleetLimitsController(wire(() => Promise.resolve(okDescribe({
      ok: false,
      error: { code: 'internal', message: 'boom', details: {} },
    }))))

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'boom' })
  })

  it('refuses a concurrent read without disturbing the first', async () => {
    let release: (() => void) | undefined
    const read = vi.fn(() => new Promise<Awaited<ReturnType<DescribeFace>>>((resolve) => {
      release = () => { resolve(SERVED(VIEW)) }
    }))
    const controller = new FleetLimitsController(wire(read))

    const first = controller.load()
    const second = controller.load()
    await second
    expect(read).toHaveBeenCalledTimes(1)
    release!()
    await first
    expect(controller.store.getSnapshot().status).toBe('ready')
  })

  it('reports a malformed served view instead of rendering it', async () => {
    const broken = { ...VIEW, value: { maxMembers: 'many' } } as unknown as SettingsNamespaceView
    const controller = new FleetLimitsController(wire(() => Promise.resolve(SERVED(broken))))

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'fleet: settings view is malformed' })
  })

  it('carries a transport failure of the read into the snapshot', async () => {
    const controller = new FleetLimitsController(wire(() => Promise.reject(new Error('connection down'))))

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'connection down' })
  })

  it('stringifies a rejection that is not an Error', async () => {
    const controller = new FleetLimitsController(wire(() => Promise.reject('wire cut')))

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'wire cut' })
  })

  it('stops a late read success from publishing after disposal', async () => {
    let release: (() => void) | undefined
    const read = vi.fn(() => new Promise<Awaited<ReturnType<DescribeFace>>>((resolve) => {
      release = () => { resolve(SERVED(VIEW)) }
    }))
    const controller = new FleetLimitsController(wire(read))

    const pending = controller.load()
    controller.dispose()
    release!()
    await pending

    expect(controller.store.getSnapshot().status).toBe('loading')
  })

  it('stops a late read failure from publishing after disposal', async () => {
    let release: (() => void) | undefined
    const read = vi.fn(() => new Promise<Awaited<ReturnType<DescribeFace>>>((_resolve, reject) => {
      release = () => { reject(new Error('late failure')) }
    }))
    const controller = new FleetLimitsController(wire(read))

    const pending = controller.load()
    controller.dispose()
    release!()
    await pending

    expect(controller.store.getSnapshot().status).toBe('loading')
  })
})

describe('FleetLimitsController.save', () => {
  it('writes both limits at the revision it read and stores the response view', async () => {
    const next = { ...VIEW, value: { maxMembers: 2, maxFanoutDepth: 1 }, revision: 4 } as unknown as SettingsNamespaceView
    const update = vi.fn(() => Promise.resolve(okUpdate({ ok: true, value: next })))
    const controller = new FleetLimitsController(wire(() => Promise.resolve(SERVED(VIEW)), update))
    await controller.load()

    await controller.save({ maxMembers: 2, maxFanoutDepth: 1 })

    expect(update).toHaveBeenCalledWith({
      ns: FLEET_SETTINGS_NS,
      patch: { maxMembers: 2, maxFanoutDepth: 1 },
      expectedRevision: 3,
    })
    expect(controller.store.getSnapshot()).toEqual({
      status: 'ready',
      error: null,
      value: { maxMembers: 2, maxFanoutDepth: 1 },
      writable: true,
    })
  })

  it('keeps the last limits and shows the refusal message on a rejected write', async () => {
    const controller = new FleetLimitsController(wire(
      () => Promise.resolve(SERVED(VIEW)),
      () => Promise.resolve(okUpdate({ ok: false, error: {
        code: 'settings-rejected',
        message: 'fleet: maxMembers must be a positive integer',
        details: { ns: FLEET_SETTINGS_NS },
      } })),
    ))
    await controller.load()

    await controller.save({ maxMembers: 0, maxFanoutDepth: 1 })

    const snapshot = controller.store.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.error).toBe('fleet: maxMembers must be a positive integer')
    expect(snapshot.value).toEqual({ maxMembers: 5, maxFanoutDepth: 2 })
  })

  it('skips the write before any view was served', async () => {
    const update = vi.fn()
    const controller = new FleetLimitsController(wire(
      () => Promise.resolve(SERVED(undefined)),
      update as never,
    ))
    await controller.load()

    await controller.save({ maxMembers: 2, maxFanoutDepth: 1 })

    expect(update).not.toHaveBeenCalled()
  })

  it('skips the write while another one is in flight', async () => {
    let release: (() => void) | undefined
    const update = vi.fn(() => new Promise<Awaited<ReturnType<UpdateFace>>>((resolve) => {
      release = () => { resolve(okUpdate({ ok: true, value: VIEW })) }
    }))
    const controller = new FleetLimitsController(wire(() => Promise.resolve(SERVED(VIEW)), update))
    await controller.load()

    const first = controller.save({ maxMembers: 2, maxFanoutDepth: 1 })
    await controller.save({ maxMembers: 3, maxFanoutDepth: 1 })
    expect(update).toHaveBeenCalledTimes(1)
    release!()
    await first
  })

  it('stops a late response from publishing after disposal', async () => {
    let release: (() => void) | undefined
    const update = vi.fn(() => new Promise<Awaited<ReturnType<UpdateFace>>>((resolve) => {
      release = () => { resolve(okUpdate({ ok: true, value: { ...VIEW, value: { maxMembers: 2, maxFanoutDepth: 1 } } })) }
    }))
    const controller = new FleetLimitsController(wire(() => Promise.resolve(SERVED(VIEW)), update))
    await controller.load()

    const pending = controller.save({ maxMembers: 2, maxFanoutDepth: 1 })
    controller.dispose()
    release!()
    await pending

    expect(controller.store.getSnapshot().status).toBe('saving')
  })

  it('keeps the last limits and reports a transport failure of the write', async () => {
    const controller = new FleetLimitsController(wire(
      () => Promise.resolve(SERVED(VIEW)),
      () => Promise.reject(new Error('update dropped')),
    ))
    await controller.load()

    await controller.save({ maxMembers: 2, maxFanoutDepth: 1 })

    const snapshot = controller.store.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.error).toBe('update dropped')
    expect(snapshot.value).toEqual({ maxMembers: 5, maxFanoutDepth: 2 })
  })

  it('stops a late write failure from publishing after disposal', async () => {
    let release: (() => void) | undefined
    const update = vi.fn(() => new Promise<Awaited<ReturnType<UpdateFace>>>((_resolve, reject) => {
      release = () => { reject(new Error('late refusal')) }
    }))
    const controller = new FleetLimitsController(wire(() => Promise.resolve(SERVED(VIEW)), update))
    await controller.load()

    const pending = controller.save({ maxMembers: 2, maxFanoutDepth: 1 })
    controller.dispose()
    release!()
    await pending

    expect(controller.store.getSnapshot().status).toBe('saving')
  })
})

describe('limitsOf', () => {
  it('rejects shapes the fleet schema cannot produce', () => {
    expect(limitsOf(null)).toBeNull()
    expect(limitsOf('5/2')).toBeNull()
    expect(limitsOf({ maxMembers: 5 })).toBeNull()
    expect(limitsOf({ maxMembers: 5, maxFanoutDepth: 2 })).toEqual({ maxMembers: 5, maxFanoutDepth: 2 })
  })
})
