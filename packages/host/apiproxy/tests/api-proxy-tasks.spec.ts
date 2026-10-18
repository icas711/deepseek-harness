/**
 * Домен tasks.*: список только СВОИХ задач (изоляция по владельцу сессии,
 * админ включительно), одинаковый ответ на неизвестный и чужой resume,
 * возобновление прерванной задачи и typed-отказы пассивного развёртывания.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type AgentFactory } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { TaskSupervisorError } from '@deepseek-ai/dsh-task-supervisor'
import type { TaskView } from '@deepseek-ai/dsh-task-supervisor'

/** Записи-двойники с изменяемыми полями: стаб имитирует переходы реестра. */
type MutableTaskView = { -readonly [K in keyof TaskView]: TaskView[K] }
import type { TaskViewWire } from '../src/api/tasks.ts'
import { RpcId, type RpcRequest, type RpcResponse } from '../src/api/rpc.ts'

/** Сужение результата list до значения после ok-проверки. */
function tasksOf(response: RpcResponse<unknown>): readonly TaskViewWire[] {
  if (!response.result.ok) throw new Error('list failed')
  return (response.result as { ok: true; value: { tasks: TaskViewWire[] } }).value.tasks
}
import { createApiProxy } from '../src/api-proxy.ts'
import { runWithWebRequestHeaders, type WebIdentity } from '../src/web-identity.ts'

let nextRpc = 0
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`tasks-${String(nextRpc++)}`), payload }
}

const SEP = process.platform === 'win32' ? '\\' : '/'
/** Кабинетный путь, платформо-верный: isWithinRoot разделяет настоящим разделителем. */
const cab = (...segments: string[]): string => segments.join(SEP)

const IDENTITIES: Record<string, WebIdentity> = {
  anna: { login: 'anna', admin: false, root: cab('C:', 'work', 'anna') },
  bob: { login: 'bob', admin: false, root: cab('C:', 'work', 'bob') },
  admin: { login: 'admin', admin: true, root: cab('C:', 'work', 'admin') },
}

/** Записи реестра: задача anna (живая сессия), задача bob, прерванная anna. */
function records(): MutableTaskView[] {
  return [
    { taskId: 't-anna-1' as never, sessionId: SessionId('s-anna'), title: 'Отчёт', status: 'running', updatedAt: 10 },
    { taskId: 't-bob-1' as never, sessionId: SessionId('s-bob'), title: 'Чужая работа', status: 'running', updatedAt: 11 },
    { taskId: 't-anna-2' as never, sessionId: SessionId('s-cold-anna'), title: 'Холодная работа', status: 'interrupted', updatedAt: 12 },
    { taskId: 't-anna-3' as never, sessionId: SessionId('s-gone'), title: 'Пропавшая сессия', status: 'paused', updatedAt: 13 },
  ]
}

/** Заглушка супервизора над фиксированным набором записей. */
function stubSupervisor(options: { resumeError?: TaskSupervisorError } = {}) {
  const all: MutableTaskView[] = records().map(record => ({ ...record }))
  const calls: string[] = []
  return {
    calls,
    async list(): Promise<TaskView[]> {
      return all.map(record => ({ ...record }))
    },
    async resume(taskId: string): Promise<MutableTaskView> {
      calls.push(`resume:${taskId}`)
      if (options.resumeError !== undefined) throw options.resumeError
      const record = all.find(candidate => String(candidate.taskId) === taskId)
      if (record === undefined) throw new TaskSupervisorError('not tracked', 'unknown-task')
      record.status = 'running'
      return record
    },
  }
}

/** Заглушка персистенса: холодная сессия с cwd в кабинете anna. */
const PERSISTENCE = {
  list: async () => [
    { id: SessionId('s-cold-anna'), cwd: cab('C:', 'work', 'anna', 'cold'), createdAt: 1 },
    { id: SessionId('s-gone'), cwd: cab('C:', 'work', 'elsewhere'), createdAt: 2 },
  ],
}

async function harness(options: { supervisor?: object } = {}): Promise<{ api: ReturnType<typeof createApiProxy>; ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  if (options.supervisor !== undefined) ctx.provide('taskSupervisor', options.supervisor as never)
  ctx.provide('sessionPersistence', PERSISTENCE as never)
  ctx.provide('webAuth', {
    identityFromCookie: (cookie: string | undefined) => {
      const login = cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('login='))?.slice('login='.length)
      return login === undefined ? undefined : IDENTITIES[login]
    },
  } as never)
  const factory: AgentFactory = {
    async createAgent(_ownerCtx, factoryOptions) {
      const session: Session = ctx.sessions.create(
        factoryOptions.sessionId,
        factoryOptions.meta === undefined ? {} : { meta: factoryOptions.meta },
      )
      const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
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
  // Живые сессии: cwd решает кабинетную видимость задач.
  ctx.sessions.create(SessionId('s-anna'), { meta: { cwd: cab('C:', 'work', 'anna', 'live') } })
  ctx.sessions.create(SessionId('s-bob'), { meta: { cwd: cab('C:', 'work', 'bob', 'live') } })
  return { api, ctx }
}

async function callTask(
  api: unknown,
  method: 'list' | 'resume',
  payload: Record<string, unknown>,
  login: string | undefined,
): Promise<RpcResponse<unknown>> {
  const face = (api as { tasks: Record<string, ((request: RpcRequest<never>) => Promise<RpcResponse<unknown>>) | undefined> }).tasks[method]
  if (face === undefined) throw new Error('нет метода ' + method)
  return runWithWebRequestHeaders(
    login === undefined ? new Headers() : new Headers({ cookie: `login=${login}` }),
    () => face.call((api as { tasks: object }).tasks, request(payload) as RpcRequest<never>),
  )
}

async function errorOf(promise: Promise<RpcResponse<unknown>>): Promise<{ code: string; message: string }> {
  const response = await promise
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('unreachable: the call should have failed')
  return response.result.error
}

describe('домен tasks.*', () => {
  it('пассивное развёртывание отвечает tasks-unavailable', async () => {
    const { api } = await harness()
    await expect(errorOf(callTask(api, 'list', {}, 'anna'))).resolves.toMatchObject({ code: 'tasks-unavailable' })
    await expect(errorOf(callTask(api, 'resume', { taskId: 't-anna-1' }, 'anna'))).resolves.toMatchObject({ code: 'tasks-unavailable' })
  })

  it('пользователь видит только свои задачи; админ — тоже только свои', async () => {
    const { api } = await harness({ supervisor: stubSupervisor() })
    const anna = await callTask(api, 'list', {}, 'anna')
    expect(anna.result.ok).toBe(true)
    expect(tasksOf(anna).map(task => task.taskId).sort()).toEqual(['t-anna-1', 't-anna-2'])
    const admin = await callTask(api, 'list', {}, 'admin')
    expect(admin.result.ok).toBe(true)
    // Изоляция строже кабинетного правила: админ не видит чужих задач.
    expect(tasksOf(admin)).toEqual([])
    // Не-веб-вызов (TUI) видит весь реестр.
    const nonWeb = await callTask(api, 'list', {}, undefined)
    expect(nonWeb.result.ok).toBe(true)
    expect(tasksOf(nonWeb)).toHaveLength(4)
  })

  it('холодная сессия видна по cwd персистенса, пропавшая скрыта; список упорядочен по свежести', async () => {
    const { api } = await harness({ supervisor: stubSupervisor() })
    const response = await callTask(api, 'list', {}, 'anna')
    expect(response.result.ok).toBe(true)
    const tasks = tasksOf(response)
    expect(tasks.map(task => task.taskId)).toEqual(['t-anna-2', 't-anna-1'])
    expect(tasks[0]).toMatchObject({ status: 'interrupted', sessionId: 's-cold-anna' })
  })

  it('чужой и неизвестный resume отвечают одинаково; свой возобновляется', async () => {
    const supervisor = stubSupervisor()
    const { api } = await harness({ supervisor })
    await expect(errorOf(callTask(api, 'resume', { taskId: 't-bob-1' }, 'anna')))
      .resolves.toMatchObject({ code: 'tasks-task-not-found' })
    await expect(errorOf(callTask(api, 'resume', { taskId: 'no-such' }, 'anna')))
      .resolves.toMatchObject({ code: 'tasks-task-not-found' })
    expect(supervisor.calls).toEqual([])
    const resumed = await callTask(api, 'resume', { taskId: 't-anna-2' }, 'anna')
    expect(resumed.result).toEqual({ ok: true, value: {} })
    expect(supervisor.calls).toEqual(['resume:t-anna-2'])
  })

  it('отказ супервизора сворачивается в tasks-resume-rejected с текстом сервиса', async () => {
    const supervisor = stubSupervisor({
      resumeError: new TaskSupervisorError('задача уже завершена', 'invalid-transition'),
    })
    const { api } = await harness({ supervisor })
    const error = await errorOf(callTask(api, 'resume', { taskId: 't-anna-2' }, 'anna'))
    expect(error.code).toBe('tasks-resume-rejected')
    expect(error.message).toContain('уже завершена')
  })
})
