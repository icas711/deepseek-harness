// @vitest-environment jsdom
/** Пикер станции исполнения: список, отложенный выбор, пустой список, недоступный мост. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { ExecutionTargetChip } from '../src/client/skeleton/ExecutionTargetChip.tsx'
import type { ExecutionTargetChipProps } from '../src/client/skeleton/ExecutionTargetChip.tsx'
import { ExecutionTargetController, stagedName } from '../src/client/execution-target-store.ts'
import { ru } from '../src/client/locales.ts'

afterEach(cleanup)

const STATIONS = [
  { stationId: 'stn-1', login: 'u', name: 'Ноутбук', rootPath: '/w/1', platform: 'linux' as const, online: true, lastSeenAt: 1, createdAt: 1 },
  { stationId: 'stn-2', login: 'u', name: 'Нетбук', rootPath: '/w/2', platform: 'win32' as const, online: false, lastSeenAt: 2, createdAt: 2 },
]

function fakeApi(
  result:
    | { ok: true; value: { stations: typeof STATIONS } }
    | { ok: false; error: { code: string; message: string; details: object } },
) {
  return { stations: { list: vi.fn(async () => ({ result })) } }
}

function renderChip(api: ReturnType<typeof fakeApi>) {
  const controller = new ExecutionTargetController(api as never)
  const props: ExecutionTargetChipProps = {
    controller,
    useExecutionTarget: bindSnapshotSelector(controller.store),
    t: (key: Parameters<ExecutionTargetChipProps['t']>[0],
      params?: Record<string, unknown>) => {
      const table = ru as Record<string, string>
      let text: string = table[key] ?? key
      for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll('{' + name + '}', String(value))
      return text
    },
  }
  render(<ExecutionTargetChip {...props} />)
  return { controller, api }
}

describe('пикер станции исполнения', () => {
  it('показывает «Сервер», меню с пунктами станций и маркером связи; выбор меняет подпись', async () => {
    const { controller } = renderChip(fakeApi({ ok: true, value: { stations: STATIONS } }))
    await waitFor(() => { expect(screen.getByText(ru['executionTarget.server'])).toBeTruthy() })
    fireEvent.click(screen.getByLabelText(ru['executionTarget.label']))
    expect(screen.getByText(ru['executionTarget.station'].replace('{name}', 'Ноутбук'))).toBeTruthy()
    fireEvent.click(screen.getByText(ru['executionTarget.station'].replace('{name}', 'Ноутбук')))
    expect(controller.store.getSnapshot().staged).toBe('stn-1')
    expect(stagedName(controller.store.getSnapshot())).toBe('Ноутбук')
    expect(controller.stagedTarget()).toEqual({ stationId: 'stn-1' })
    // Чип подписывается станцией; возврат на «Сервер» снимает привязку.
    expect(screen.getByText(ru['executionTarget.station'].replace('{name}', 'Ноутбук'))).toBeTruthy()
    fireEvent.click(screen.getByLabelText(ru['executionTarget.label']))
    fireEvent.click(screen.getByText(ru['executionTarget.server']))
    expect(controller.stagedTarget()).toBeUndefined()
  })

  it('пустой список станций — задизейбленный пункт с подсказкой про dsh-station pair', async () => {
    renderChip(fakeApi({ ok: true, value: { stations: [] } }))
    await waitFor(() => { expect(screen.getByText(ru['executionTarget.server'])).toBeTruthy() })
    fireEvent.click(screen.getByLabelText(ru['executionTarget.label']))
    const empty = screen.getByText(ru['executionTarget.empty'])
    expect(empty.closest('button')).toHaveProperty('disabled', true)
  })

  it('недоступный мост станций прячет чип', async () => {
    renderChip(fakeApi({ ok: false, error: { code: 'stations-unavailable', message: 'нужен вход через веб', details: {} } }))
    await waitFor(() => { expect(screen.queryByText(ru['executionTarget.server'])).toBeNull() })
  })
})
