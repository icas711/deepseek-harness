// @vitest-environment jsdom
/** Страница «Задачи»: закрытое состояние, список с бейджами, «Продолжить», без отметки завершённой. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { TasksPage } from '../src/client/TasksPage.tsx'
import type { TasksPageProps } from '../src/client/TasksPage.tsx'
import { TasksController } from '../src/client/store.ts'
import { TasksUiController } from '../src/client/ui-store.ts'
import { ru } from '../src/client/locales.ts'

afterEach(cleanup)

const TASKS = [
  { taskId: 't1', sessionId: 's1', title: 'Собрать отчёт', status: 'interrupted' as const, updatedAt: Date.now() - 120_000 },
  { taskId: 't2', sessionId: 's2', title: 'Починить сборку', status: 'completed' as const, updatedAt: Date.now() - 7_000 },
  { taskId: 't3', sessionId: 's3', title: 'Станционная работа', status: 'waiting-station' as const, updatedAt: Date.now() - 3_600_000, stationId: 'stn-1' },
]

function fakeApi() {
  return {
    tasks: {
      list: vi.fn(async () => ({ result: { ok: true, value: { tasks: TASKS } } })),
      resume: vi.fn(async () => ({ result: { ok: true, value: {} } })),
    },
  }
}

/** Отрендерить страницу над живыми контроллерами. */
function renderPage(api = fakeApi(), ui = new TasksUiController()) {
  const controller = new TasksController(api as never)
  const t: TasksPageProps['t'] = (key, params) => {
    let text: string = ru[key]
    for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll('{' + name + '}', String(value))
    return text
  }
  const props: TasksPageProps = {
    controller,
    useTasks: bindSnapshotSelector(controller.store),
    useUi: bindSnapshotSelector(ui.store),
    closeUi: () => { ui.close() },
    openSession: vi.fn(),
    t,
  }
  const renderResult = render(<TasksPage {...props} />)
  return { controller, api, ui, openSession: props.openSession as ReturnType<typeof vi.fn>, renderResult }
}

describe('страница «Задачи»', () => {
  it('закрытая страница рендерит null и не читает список', () => {
    const { api } = renderPage()
    expect(screen.queryByText(ru.title)).toBeNull()
    expect(api.tasks.list).not.toHaveBeenCalled()
  })

  it('открытая страница показывает задачи: статус, станцию, время', async () => {
    const { ui } = renderPage()
    ui.open()
    await waitFor(() => { expect(screen.getByText('Собрать отчёт')).toBeTruthy() })
    expect(screen.getByText('Починить сборку')).toBeTruthy()
    expect(screen.getByText(ru.statusInterrupted)).toBeTruthy()
    expect(screen.getByText(ru.statusCompleted)).toBeTruthy()
    expect(screen.getByText(ru.statusWaitingStation)).toBeTruthy()
    // Станция названа идентификатором, локальные — «Сервер».
    expect(screen.getByText('stn-1')).toBeTruthy()
    expect(screen.getAllByText(ru.stationServer).length).toBeGreaterThanOrEqual(2)
    // Отметки «завершённой» нет вовсе.
    expect(screen.queryByText('Отметить завершённой')).toBeNull()
  })

  it('«Продолжить» есть только у стоящих задач и зовёт resume с идентификатором', async () => {
    const { api, ui } = renderPage()
    ui.open()
    await waitFor(() => { expect(screen.getByText('Собрать отчёт')).toBeTruthy() })
    const buttons = screen.getAllByText(ru.resume)
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[0]!)
    await waitFor(() => { expect(api.tasks.resume).toHaveBeenCalledWith({ taskId: 't1' }) })
    // Завершённая задача продолжения не предлагает.
    const completedRow = screen.getByText('Починить сборку').closest('div')!.parentElement!
    expect(completedRow.textContent).not.toContain(ru.resume)
  })

  it('переход к сессии закрывает страницу и зовёт навигацию', async () => {
    const { ui, openSession } = renderPage()
    ui.open()
    await waitFor(() => { expect(screen.getByText('Собрать отчёт')).toBeTruthy() })
    fireEvent.click(screen.getAllByText(ru.openSession)[0]!)
    expect(openSession).toHaveBeenCalledWith('s1')
    expect(ui.store.getSnapshot().open).toBe(false)
  })

  it('крест закрывает страницу', async () => {
    const { ui } = renderPage()
    ui.open()
    await waitFor(() => { expect(screen.getByText(ru.title)).toBeTruthy() })
    fireEvent.click(screen.getByLabelText(ru.close))
    expect(ui.store.getSnapshot().open).toBe(false)
  })
})
