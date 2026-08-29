// @vitest-environment jsdom
/**
 * The General-settings row's presentation behavior: the disclosure the host
 * worded, the refresh control, and the mode selector that appears only where
 * the deployment can change the mode at runtime.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { TelemetryStatusRow } from '../src/client/TelemetryStatusRow.tsx'
import type { TelemetryStatusRowProps } from '../src/client/TelemetryStatusRow.tsx'
import type { TelemetryStatusState } from '../src/client/store.ts'
import { ru } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof ru) => ru[key]

const READY: TelemetryStatusState = {
  status: 'ready',
  error: null,
  value: { sharing: 'feedback-only', configuredMode: 'FEEDBACK_ONLY', changeable: true },
}

function renderRow(state: Partial<TelemetryStatusState> = {}) {
  const store = createSnapshotStore<TelemetryStatusState>({ ...READY, ...state })
  const actions = { load: vi.fn(() => Promise.resolve()), select: vi.fn(() => Promise.resolve()) }
  render(<TelemetryStatusRow {...({
    ...actions,
    useTelemetryStatus: bindSnapshotSelector(store),
    t,
  } as unknown as TelemetryStatusRowProps)} />)
  return { actions, store }
}

describe('TelemetryStatusRow', () => {
  it('loads the disclosure on mount and shows the configured mode', async () => {
    const { actions } = renderRow()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
    expect(screen.getByRole('button', { name: new RegExp(t('telemetryStatus.feedbackOnly')) }))
      .toBeTruthy()
    expect(screen.getByText(t('telemetryStatus.feedbackOnlyDesc'))).toBeTruthy()
  })

  it('re-reads the disclosure when the refresh control fires', async () => {
    const { actions } = renderRow()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByRole('button', { name: t('telemetryStatus.refresh') }))
    expect(actions.load).toHaveBeenCalledTimes(2)
  })

  it('writes a picked mode through the selector', async () => {
    const { actions } = renderRow()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('telemetryStatus.feedbackOnly')) }))
    fireEvent.click(screen.getByText(t('telemetryStatus.full')))

    await waitFor(() => { expect(actions.select).toHaveBeenCalledWith('FULL') })
  })

  it('renders the status without a selector where the deployment cannot change it live', () => {
    renderRow({ value: { sharing: 'disabled', configuredMode: 'DISABLED', changeable: false } })

    expect(screen.getByText(t('telemetryStatus.disabledDesc'))).toBeTruthy()
    // The status word is plain text, and no menu trigger exists.
    expect(screen.queryByRole('button', { name: new RegExp(t('telemetryStatus.disabled')) })).toBeNull()
    expect(screen.queryByRole('button', { name: t('telemetryStatus.refresh') })).not.toBeNull()
  })

  it('renders only the explanatory text when no backend is composed', () => {
    renderRow({ status: 'unavailable', value: null })

    expect(screen.getByText(t('telemetryStatus.unavailable'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: new RegExp(t('telemetryStatus.feedbackOnly')) })).toBeNull()
  })

  it('shows the failure in the description slot while the disclosure stays', () => {
    renderRow({ error: 'exporter.url is required' })

    expect(screen.getByRole('alert').textContent).toBe('exporter.url is required')
  })

  it('disables both controls while a write is in flight', () => {
    const { store } = renderRow({ status: 'saving' })

    expect(screen.getByRole<HTMLButtonElement>('button', { name: t('telemetryStatus.refresh') }).disabled)
      .toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: new RegExp(t('telemetryStatus.feedbackOnly')) }).disabled)
      .toBe(true)

    act(() => { store.set({ ...store.getSnapshot(), status: 'ready' }) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: t('telemetryStatus.refresh') }).disabled)
      .toBe(false)
  })
})
