// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore, type ConnectionHealth, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ConnectionBanner } from '../src/client/skeleton/ConnectionBanner.tsx'
import type { ConnectionBannerProps } from '../src/client/skeleton/ConnectionBanner.tsx'
import { ru } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }))
}

function mount(health: ReturnType<typeof createSnapshotStore<ConnectionHealth>>) {
  const props: ConnectionBannerProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useConnectionHealth: bindSnapshotSelector(health),
    t: makeTranslate(ru),
  }
  render(<ConnectionBanner {...props} />)
  return health
}

describe('ConnectionBanner', () => {
  it('stays quiet while the connection is up', () => {
    mount(createSnapshotStore<ConnectionHealth>('connected'))
    expect(screen.queryByText(ru['connection.down'])).toBeNull()
  })

  it('stays quiet during the initial boot span', () => {
    mount(createSnapshotStore<ConnectionHealth>('connecting'))
    expect(screen.queryByText(ru['connection.down'])).toBeNull()
  })

  it('shows the persistent process-down strip while the connection is dead', () => {
    mount(createSnapshotStore<ConnectionHealth>('reconnecting'))
    expect(screen.getByRole('status').textContent).toBe(ru['connection.down'])
  })

  it('retreats when a connection generation lands again', () => {
    const health = mount(createSnapshotStore<ConnectionHealth>('reconnecting'))
    expect(screen.getByRole('status')).toBeDefined()
    act(() => { health.set('connected') })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
