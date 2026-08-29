/**
 * Store behavior over a programmable wire face: the disclosure read, the
 * mode write, and how each refusal lands in the snapshot.
 */

import { describe, expect, it, vi } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { RpcId } from '@deepseek-ai/dsh-client-connection/client'
import { TelemetryStatusController, TELEMETRY_SETTINGS_NS } from '../src/client/store.ts'

type HostFace = IApiClient['host']
type SettingsFace = IApiClient['settings']

function okHost(value: Awaited<ReturnType<HostFace['telemetryStatus']>>['result']) {
  return { rpcId: RpcId('r'), result: value }
}

function okSettings(value: Awaited<ReturnType<SettingsFace['update']>>['result']) {
  return { rpcId: RpcId('r'), result: value }
}

const DISCLOSURE = {
  sharing: 'feedback-only',
  configuredMode: 'FEEDBACK_ONLY',
  changeable: true,
} as const

function wire(
  host: HostFace['telemetryStatus'],
  update: SettingsFace['update'] = () => Promise.resolve(okSettings({ ok: true, value: {
    ns: TELEMETRY_SETTINGS_NS, schema: {}, value: {}, applies: 'live', secrets: [], revision: 1,
  } })),
): IApiClient {
  return { host: { telemetryStatus: host }, settings: { update } } as unknown as IApiClient
}

describe('TelemetryStatusController.load', () => {
  it('lands a disclosure in the snapshot', async () => {
    const read = vi.fn(() => Promise.resolve(okHost({ ok: true, value: DISCLOSURE })))
    const controller = new TelemetryStatusController(wire(read))

    await controller.load()

    expect(read).toHaveBeenCalledWith({})
    expect(controller.store.getSnapshot()).toEqual({
      status: 'ready',
      error: null,
      value: DISCLOSURE,
    })
  })

  it('renders a backend-free host as unavailable, not failed', async () => {
    const controller = new TelemetryStatusController(wire(() => Promise.resolve(okHost({
      ok: false,
      error: { code: 'telemetry-not-configured', message: 'no backend', details: {} },
    }))))

    await controller.load()

    expect(controller.store.getSnapshot()).toEqual({
      status: 'unavailable',
      error: null,
      value: null,
    })
  })

  it('keeps the refusal message for other host errors', async () => {
    const controller = new TelemetryStatusController(wire(() => Promise.resolve(okHost({
      ok: false,
      error: { code: 'internal', message: 'boom', details: {} },
    }))))

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'boom' })
  })

  it('refuses a concurrent read without disturbing the first', async () => {
    let release: (() => void) | undefined
    const read = vi.fn(() => new Promise<Awaited<ReturnType<HostFace['telemetryStatus']>>>((resolve) => {
      release = () => { resolve(okHost({ ok: true, value: DISCLOSURE })) }
    }))
    const controller = new TelemetryStatusController(wire(read))

    const first = controller.load()
    const second = controller.load()
    await second
    expect(read).toHaveBeenCalledTimes(1)
    release!()
    await first
    expect(controller.store.getSnapshot().status).toBe('ready')
  })
})

describe('TelemetryStatusController.select', () => {
  it('writes the mode and re-reads the disclosure', async () => {
    const update = vi.fn(() => Promise.resolve(okSettings({ ok: true, value: {
      ns: TELEMETRY_SETTINGS_NS, schema: {}, value: {}, applies: 'live', secrets: [], revision: 2,
    } })))
    const read = vi.fn(() => Promise.resolve(okHost({ ok: true, value: DISCLOSURE })))
    const controller = new TelemetryStatusController(wire(read, update))
    await controller.load()

    await controller.select('FULL')

    expect(update).toHaveBeenCalledWith({ ns: TELEMETRY_SETTINGS_NS, patch: { mode: 'FULL' } })
    // The write alone is not the row's truth: the disclosure is re-read.
    expect(read).toHaveBeenCalledTimes(2)
    expect(controller.store.getSnapshot().status).toBe('ready')
  })

  it('skips a write that would re-select the configured mode', async () => {
    const update = vi.fn()
    const controller = new TelemetryStatusController(wire(
      () => Promise.resolve(okHost({ ok: true, value: DISCLOSURE })),
      update as never,
    ))
    await controller.load()

    await controller.select('FEEDBACK_ONLY')

    expect(update).not.toHaveBeenCalled()
  })

  it('keeps the last disclosure and shows the refusal message on a rejected write', async () => {
    const controller = new TelemetryStatusController(wire(
      () => Promise.resolve(okHost({ ok: true, value: DISCLOSURE })),
      () => Promise.resolve(okSettings({ ok: false, error: {
        code: 'settings-rejected',
        message: 'exporter.url is required',
        details: { ns: TELEMETRY_SETTINGS_NS },
      } })),
    ))
    await controller.load()

    await controller.select('FULL')

    const snapshot = controller.store.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.error).toBe('exporter.url is required')
    expect(snapshot.value).toEqual(DISCLOSURE)
  })
})
