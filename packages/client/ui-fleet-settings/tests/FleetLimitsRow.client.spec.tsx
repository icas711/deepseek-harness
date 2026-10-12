// @vitest-environment jsdom
/**
 * The General-settings row's presentation behavior: the limits the host
 * resolved, the refresh control, the two integer fields, the apply control
 * that appears only where the document accepts writes, and the collapsible
 * prompt examples with their clipboard copy.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { FleetLimitsRow } from '../src/client/FleetLimitsRow.tsx'
import type { FleetLimitsRowProps } from '../src/client/FleetLimitsRow.tsx'
import type { FleetLimitsState } from '../src/client/store.ts'
import { ru } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof ru) => ru[key]

const READY: FleetLimitsState = {
  status: 'ready',
  error: null,
  value: { maxMembers: 5, maxFanoutDepth: 2 },
  writable: true,
}

function renderRow(state: Partial<FleetLimitsState> = {}) {
  const store = createSnapshotStore<FleetLimitsState>({ ...READY, ...state })
  const actions = { load: vi.fn(() => Promise.resolve()), save: vi.fn(() => Promise.resolve()) }
  render(<FleetLimitsRow {...({
    ...actions,
    useFleetLimits: bindSnapshotSelector(store),
    t,
  } as unknown as FleetLimitsRowProps)} />)
  return { actions, store }
}

describe('FleetLimitsRow', () => {
  it('loads the served view on mount and shows the limits', async () => {
    const { actions } = renderRow()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
    expect((screen.getByLabelText(t('fleetLimits.maxMembers')) as HTMLInputElement).value).toBe('5')
    expect((screen.getByLabelText(t('fleetLimits.maxFanoutDepth')) as HTMLInputElement).value).toBe('2')
  })

  it('re-reads the served view when the refresh control fires', async () => {
    const { actions } = renderRow()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByRole('button', { name: t('fleetLimits.refresh') }))
    expect(actions.load).toHaveBeenCalledTimes(2)
  })

  it('writes edited integers through the apply control', async () => {
    const { actions } = renderRow()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
    fireEvent.change(screen.getByLabelText(t('fleetLimits.maxMembers')), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: t('fleetLimits.apply') }))

    await waitFor(() => { expect(actions.save).toHaveBeenCalledWith({ maxMembers: 3, maxFanoutDepth: 2 }) })
  })

  it('refuses a non-integer edit instead of writing it', async () => {
    const { actions } = renderRow()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
    fireEvent.change(screen.getByLabelText(t('fleetLimits.maxMembers')), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: t('fleetLimits.apply') }))

    expect(actions.save).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(t('fleetLimits.invalid'))
  })

  it('disables the apply control until an edit diverges', async () => {
    renderRow()

    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: t('fleetLimits.apply') }).disabled).toBe(true) })
    fireEvent.change(screen.getByLabelText(t('fleetLimits.maxFanoutDepth')), { target: { value: '4' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: t('fleetLimits.apply') }).disabled).toBe(false)
  })

  it('renders only the explanatory text when no fleet service is composed', async () => {
    renderRow({ status: 'unavailable', value: null })

    expect(screen.getByText(t('fleetLimits.unavailable'))).toBeTruthy()
    expect(screen.queryByLabelText(t('fleetLimits.maxMembers'))).toBeNull()
  })

  it('shows the failure in the description slot while the limits stay', () => {
    renderRow({ error: 'fleet: maxMembers must be a positive integer' })

    expect(screen.getByRole('alert').textContent).toBe('fleet: maxMembers must be a positive integer')
    expect((screen.getByLabelText(t('fleetLimits.maxMembers')) as HTMLInputElement).value).toBe('5')
  })

  it('disables both controls while a write is in flight', () => {
    const { store } = renderRow({ status: 'saving' })

    expect(screen.getByRole<HTMLButtonElement>('button', { name: t('fleetLimits.refresh') }).disabled).toBe(true)
    expect((screen.getByLabelText(t('fleetLimits.maxMembers')) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: t('fleetLimits.apply') }).disabled).toBe(true)

    act(() => { store.set({ ...store.getSnapshot(), status: 'ready' }) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: t('fleetLimits.refresh') }).disabled).toBe(false)
  })

  it('follows an externally moved host value', () => {
    const { store } = renderRow()

    act(() => { store.set({ ...store.getSnapshot(), value: { maxMembers: 8, maxFanoutDepth: 1 } }) })
    expect((screen.getByLabelText(t('fleetLimits.maxMembers')) as HTMLInputElement).value).toBe('8')
    expect((screen.getByLabelText(t('fleetLimits.maxFanoutDepth')) as HTMLInputElement).value).toBe('1')
  })

  it('expands the usage examples and collapses them again', () => {
    renderRow({ status: 'unavailable', value: null })
    expect(screen.queryByText(t('fleetLimits.usageIntro'))).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: t('fleetLimits.usage') }))
    expect(screen.getByText(t('fleetLimits.usageIntro'))).toBeTruthy()
    expect(screen.getByText(t('fleetLimits.exampleParallelTitle'))).toBeTruthy()
    expect(screen.getByText(t('fleetLimits.exampleSplitTitle'))).toBeTruthy()
    expect(screen.getByText(t('fleetLimits.exampleCompareTitle'))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: t('fleetLimits.usage') }))
    expect(screen.queryByText(t('fleetLimits.usageIntro'))).toBeNull()
  })

  it('copies a prompt through the async clipboard API', () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderRow()

    fireEvent.click(screen.getByRole('button', { name: t('fleetLimits.usage') }))
    fireEvent.click(screen.getAllByRole<HTMLButtonElement>('button', { name: t('fleetLimits.copy') })[0]!)

    expect(writeText).toHaveBeenCalledWith(t('fleetLimits.exampleParallelText'))
  })

  it('copies a prompt through the legacy command when the clipboard API is absent', () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const execCommand = vi.fn(() => true)
    document.execCommand = execCommand as unknown as typeof document.execCommand
    renderRow()

    fireEvent.click(screen.getByRole('button', { name: t('fleetLimits.usage') }))
    fireEvent.click(screen.getAllByRole<HTMLButtonElement>('button', { name: t('fleetLimits.copy') })[1]!)

    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('keeps the row rendered when every copy route is refused', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    document.execCommand = (() => false) as unknown as typeof document.execCommand
    renderRow()

    fireEvent.click(screen.getByRole('button', { name: t('fleetLimits.usage') }))
    fireEvent.click(screen.getAllByRole<HTMLButtonElement>('button', { name: t('fleetLimits.copy') })[2]!)

    await waitFor(() => { expect(screen.getByText(t('fleetLimits.exampleCompareText'))).toBeTruthy() })
  })
})
