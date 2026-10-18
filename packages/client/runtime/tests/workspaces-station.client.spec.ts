/** connectWorkspace с executionTarget: пропуск переиспользования blank и привязка в session.create. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { SessionRuntime } from '../src/client/sessions/service.ts'
import { WorkspaceRuntime } from '../src/client/workspaces/service.ts'
import { FakeApiClient, ok } from './fake-api.client.ts'

const sid = (id: string): SessionId => id as SessionId
const wid = (id: string): WorkspaceId => id as WorkspaceId

function workspace(id: string, sessionIds: SessionId[] = []): WorkspaceView {
  return { workspaceId: wid(id), path: `/w/${id}`, title: id, sessionIds, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
}

async function harness(opts: { blankInWorkspace?: boolean } = {}) {
  const ctx = new Context()
  const api = new FakeApiClient()
  const createCalls: unknown[] = []
  const sessions = new SessionRuntime(ctx, api, { dispatch: async () => { throw new Error('no remotes') } } as never)
  const workspaces = new WorkspaceRuntime(ctx, api, sessions as never)
  api.onWorkspaceList = () => Promise.resolve(ok({
    items: [workspace('alpha', opts.blankInWorkspace === true ? [sid('s-blank')] : [])] as never[],
  }))
  api.onList = () => Promise.resolve(ok({
    items: (opts.blankInWorkspace === true
      ? [{ sessionId: sid('s-blank'), updatedAt: 1, running: false, blank: true, cwd: '/w/alpha' }]
      : []) as never[],
  }))
  await workspaces.refresh()
  await sessions.refresh()
  await Promise.resolve()
  await Promise.resolve()
  // Шпион на create поверх домена: менеджер пишет через api.sessions.create.
  const inner = api.sessions.create.bind(api.sessions)
  api.sessions.create = (payload: never) => {
    createCalls.push(payload)
    return Promise.resolve({ rpcId: 'x' as never, result: { ok: true, value: { sessionId: sid('s-new') } } })
  }
  void inner
  return { workspaces, createCalls }
}

describe('connectWorkspace с executionTarget', () => {
  it('станционная привязка запрещает переиспользование blank и едет в create', async () => {
    const { workspaces, createCalls } = await harness({ blankInWorkspace: true })
    const id = await workspaces.connectWorkspace(wid('alpha'), { stationId: 'stn-1' })
    expect(id).toBe('s-new')
    expect(createCalls).toEqual([{ workspaceId: 'alpha', executionTarget: { stationId: 'stn-1' } }])
  })

  it('без привязки blank в рабочей области переиспользуется, create не зовётся', async () => {
    const { workspaces, createCalls } = await harness({ blankInWorkspace: true })
    const id = await workspaces.connectWorkspace(wid('alpha'))
    expect(id).toBe('s-blank')
    expect(createCalls).toEqual([])
  })
})
