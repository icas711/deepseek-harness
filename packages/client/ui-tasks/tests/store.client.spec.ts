/** Контроллер задач: загрузка, ошибка, возобновление с перечитыванием, относительное время. */
import { describe, expect, it, vi } from 'vitest'
import { TasksController, relativeWhen, whenParams } from '../src/client/store.ts'

function fakeApi() {
  return {
    tasks: {
      list: vi.fn(async () => ({ result: { ok: true, value: { tasks: [] } } })),
      resume: vi.fn(async () => ({ result: { ok: true, value: {} } })),
    },
  }
}

describe('TasksController', () => {
  it('load читает список и переводит статус в ready', async () => {
    const api = fakeApi()
    api.tasks.list.mockResolvedValue({ result: { ok: true, value: { tasks: [{ taskId: 't1', sessionId: 's1', title: 'Работа', status: 'running', updatedAt: 5 }] } } })
    const controller = new TasksController(api as never)
    await controller.load()
    expect(api.tasks.list).toHaveBeenCalledWith({})
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', error: null })
    expect(controller.store.getSnapshot().tasks[0]).toMatchObject({ taskId: 't1', title: 'Работа' })
  })

  it('отказ хоста остаётся ошибкой страницы с текстом хоста', async () => {
    const api = fakeApi()
    api.tasks.list.mockResolvedValue({ result: { ok: false, error: { code: 'tasks-unavailable', message: 'задачи недоступны', details: {} } } })
    const controller = new TasksController(api as never)
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'задачи недоступны' })
  })

  it('resume зовёт tasks.resume и перечитывает список; отказ показывается', async () => {
    const api = fakeApi()
    const controller = new TasksController(api as never)
    await controller.load()
    api.tasks.resume.mockResolvedValue({ result: { ok: false, error: { code: 'tasks-resume-rejected', message: 'задача уже завершена', details: { taskId: 't1' } } } })
    await controller.resume('t1')
    expect(api.tasks.resume).toHaveBeenCalledWith({ taskId: 't1' })
    expect(api.tasks.list).toHaveBeenCalledTimes(2)
    expect(controller.store.getSnapshot()).toMatchObject({ busyTaskId: null, error: 'задача уже завершена' })
  })
})

describe('relativeWhen', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0)

  it('выбирает единицу по прошествии', () => {
    expect(relativeWhen(now - 10_000, now)).toBe('now')
    expect(relativeWhen(now - 5 * 60_000, now)).toBe('minutesAgo')
    expect(relativeWhen(now - 3 * 3_600_000, now)).toBe('hoursAgo')
    expect(relativeWhen(now - 2 * 86_400_000, now)).toBe('daysAgo')
  })

  it('whenParams считает параметр подстановки', () => {
    expect(whenParams('minutesAgo', now - 7 * 60_000, now)).toEqual({ count: 7 })
    expect(whenParams('hoursAgo', now - 3 * 3_600_000, now)).toEqual({ count: 3 })
    expect(whenParams('daysAgo', now - 2 * 86_400_000, now)).toEqual({ count: 2 })
  })
})
