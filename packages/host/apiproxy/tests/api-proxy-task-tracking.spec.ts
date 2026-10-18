/**
 * Проводка супервизора в бандл-флоу: принятый промпт регистрирует задачу
 * (станционная сессия — со stationId, локальная — без неё), исход turn'а
 * завершает её (completed → completed, error → failed); активная запись не
 * переметывается повторными промптами.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type AgentFactory } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { TaskId, TaskView } from '@deepseek-ai/dsh-task-supervisor'

/** Записи-двойники с изменяемыми полями: стаб имитирует переходы реестра. */
type MutableTaskView = { -readonly [K in keyof TaskView]: TaskView[K] }
import { RpcId, type RpcRequest, type RpcResponse } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { runWithWebRequestHeaders, type WebIdentity } from '../src/web-identity.ts'

let nextRpc = 0
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`track-${String(nextRpc++)}`), payload }
}

/** Личность по умолчанию: все сессии теста живут в её кабинете. */
const IDENTITIES: Record<string, WebIdentity> = {
  anna: { login: 'anna', admin: false, root: '/work/anna' },
}

/** Активные (нетерминальные) статусы — зеркало правила реестра. */
function isActive(status: TaskView['status']): boolean {
  return status === 'running' || status === 'paused' || status === 'interrupted' || status === 'waiting-station'
}

/** Заглушка супервизора: запись задач и вызовов в памяти. */
function stubSupervisor() {
  const records: MutableTaskView[] = []
  const calls: string[] = []
  let next = 0
  const find = (taskId: string): MutableTaskView | undefined =>
    records.find(record => String(record.taskId) === taskId)
  return {
    records,
    calls,
    async track(input: { sessionId: SessionId; title: string; stationId?: string }): Promise<TaskView> {
      calls.push('track')
      const existing = records.find(record => record.sessionId === input.sessionId && isActive(record.status))
      if (existing !== undefined) return existing
      const record: MutableTaskView = {
        taskId: `t-${String(++next)}` as TaskId,
        sessionId: input.sessionId,
        title: input.title,
        status: 'running',
        updatedAt: records.length + 1,
        ...(input.stationId === undefined ? {} : { stationId: input.stationId as never }),
      }
      records.push(record)
      return record
    },
    async markCompleted(taskId: string): Promise<MutableTaskView> {
      calls.push('complete')
      const record = find(taskId)
      if (record === undefined) throw new Error('unknown task')
      record.status = 'completed'
      record.updatedAt = Date.now()
      return record
    },
    async markFailed(taskId: string, reason: string): Promise<MutableTaskView> {
      calls.push(`failed:${reason}`)
      const record = find(taskId)
      if (record === undefined) throw new Error('unknown task')
      record.status = 'failed'
      record.updatedAt = Date.now()
      return record
    },
    async list(): Promise<TaskView[]> {
      return [...records]
    },
  }
}

/** Заглушка станции для executionTarget-валидации. */
const STATIONS = {
  get: async (stationId: string) => ({
    stationId, login: 'anna', name: 'ноутбук', rootPath: '/w/anna', platform: 'linux', online: true, lastSeenAt: 1, createdAt: 1,
  }),
}

/** Полигон: сессии в памяти, шлюз с проводкой, supervisor/stations/webAuth подставлены. */
async function harness(): Promise<{ api: ReturnType<typeof createApiProxy>; ctx: Context; supervisor: ReturnType<typeof stubSupervisor> }> {
  const ctx = new Context()
  const supervisor = stubSupervisor()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('taskSupervisor', supervisor as never)
  ctx.provide('stations', STATIONS as never)
  ctx.provide('webAuth', {
    identityFromCookie: (cookie: string | undefined) => {
      const login = cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('login='))?.slice('login='.length)
      return login === undefined ? undefined : IDENTITIES[login]
    },
  } as never)
  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session: Session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = {
        id: session.id,
        session,
        status: 'idle',
        followup: () => {},
        steer: () => {},
        inbox: { nextTurn: [], nextStep: [], hasPending: false, replace: () => {}, remove: () => {} },
      } as unknown as Agent
      // selectionFor лениво ставит модельную сборку в область агента — нужен ctx с .on.
      const agentCtx = ctx.extend({ agent })
      ;(agent as { ctx?: Context }).ctx = agentCtx
      const unregister = ctx.agents.register(agent)
      return { agent, dispose: () => { unregister(); return Promise.resolve() } }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: '/work/anna',
  })
  return { api, ctx, supervisor }
}

/** Ожидание асинхронной проводки (void-цепочки промпта). */
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** session.create под личностью anna. */
async function create(api: unknown, payload: Record<string, unknown>): Promise<RpcResponse<unknown>> {
  const face = (api as { sessions: { create: (request: RpcRequest<never>) => Promise<RpcResponse<unknown>> } }).sessions.create
  return runWithWebRequestHeaders(new Headers({ cookie: 'login=anna' }), () => face.call((api as { sessions: never }).sessions, request(payload) as RpcRequest<never>))
}

/** session.prompt под личностью anna. */
async function prompt(api: unknown, sessionId: string, text: string): Promise<RpcResponse<unknown>> {
  const face = (api as { sessions: { prompt: (request: RpcRequest<never>) => Promise<RpcResponse<unknown>> } }).sessions.prompt
  return runWithWebRequestHeaders(new Headers({ cookie: 'login=anna' }), () => face.call((api as { sessions: never }).sessions, request({
    sessionId: SessionId(sessionId),
    content: [{ type: 'text', text }],
  }) as RpcRequest<never>))
}

describe('проводка супервизора задач в шлюз', () => {
  it('принятый промпт станционной сессии регистрирует задачу со stationId; turn/end completed завершает её', async () => {
    const { api, ctx, supervisor } = await harness()
    await create(api, { sessionId: SessionId('s-station'), executionTarget: { stationId: 'stn-anna' } })
    const accepted = await prompt(api, 's-station', 'Собери отчёт по продажам')
    expect(accepted.result).toMatchObject({ ok: true, value: { accepted: true } })
    await until(() => supervisor.records.length === 1)
    expect(supervisor.records[0]).toMatchObject({
      sessionId: 's-station',
      title: 'Собери отчёт по продажам',
      status: 'running',
      stationId: 'stn-anna',
    })
    // Повторный промпт не переметывает активную запись: метка — первый промпт.
    await prompt(api, 's-station', 'Другая формулировка')
    await until(() => supervisor.calls.filter(call => call === 'track').length >= 2)
    expect(supervisor.records).toHaveLength(1)
    expect(supervisor.records[0]?.title).toBe('Собери отчёт по продажам')
    // Нормальный исход turn'а завершает задачу.
    ctx.sessions.get(SessionId('s-station'))?.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await until(() => supervisor.records[0]?.status === 'completed')
    expect(supervisor.calls).toContain('complete')
  })

  it('локальная сессия ведётся без stationId; ошибочный исход помечает failed с текстом', async () => {
    const { api, ctx, supervisor } = await harness()
    await create(api, { sessionId: SessionId('s-local') })
    await prompt(api, 's-local', 'Почини сборку')
    await until(() => supervisor.records.length === 1)
    expect(supervisor.records[0]).toMatchObject({ sessionId: 's-local', title: 'Почини сборку', status: 'running' })
    expect(supervisor.records[0]?.stationId).toBeUndefined()
    ctx.sessions.get(SessionId('s-local'))?.append('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { message: 'модель недоступна', code: 'UNKNOWN' } },
    })
    await until(() => supervisor.records[0]?.status === 'failed')
    expect(supervisor.calls[1]).toContain('модель недоступна')
  })

  it('отмена turn не завершает задачу', async () => {
    const { api, ctx, supervisor } = await harness()
    await create(api, { sessionId: SessionId('s-cancel') })
    await prompt(api, 's-cancel', 'Долгая работа')
    await until(() => supervisor.records.length === 1)
    ctx.sessions.get(SessionId('s-cancel'))?.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    await until(() => supervisor.calls.length >= 1)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(supervisor.records[0]?.status).toBe('running')
    expect(supervisor.calls).not.toContain('complete')
  })

  it('завершённая задача сменяется новой при следующем промпте', async () => {
    const { api, ctx, supervisor } = await harness()
    await create(api, { sessionId: SessionId('s-again') })
    await prompt(api, 's-again', 'Первая работа')
    await until(() => supervisor.records.length === 1)
    ctx.sessions.get(SessionId('s-again'))?.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await until(() => supervisor.records[0]?.status === 'completed')
    await prompt(api, 's-again', 'Вторая работа')
    await until(() => supervisor.records.length === 2)
    expect(supervisor.records[1]).toMatchObject({ sessionId: 's-again', title: 'Вторая работа', status: 'running' })
  })
})
