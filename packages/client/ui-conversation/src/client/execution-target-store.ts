/**
 * Контроллер пикера станции исполнения на экране новой сессии: список станций
 * из station.list и отложенный выбор «Сервер» / «Станция ⟨имя⟩». Выбор
 * расходуется созданием следующей сессии с этого экрана — привязка валидируется
 * на хосте в session.create и правке после создания не подлежит.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Строка меню пикера: свои станции вызывающего (обзор без секретов). */
export interface StationOption {
  stationId: string
  name: string
  online: boolean
}

/** Снимок пикера станции исполнения. */
export interface ExecutionTargetState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Отказ загрузки списка; 'stations-unavailable' прячет чип вовсе. */
  error: string | null
  unavailable: boolean
  stations: readonly StationOption[]
  /** Отложенный выбор: undefined — «Сервер». */
  staged: string | undefined
}

/** Начальный снимок. */
export const INITIAL_EXECUTION_TARGET: ExecutionTargetState = {
  status: 'idle',
  error: null,
  unavailable: false,
  stations: [],
  staged: undefined,
}

/** Имя выбранной станции для подписи чипа; выбор без записи — «Сервер». */
export function stagedName(state: ExecutionTargetState): string | undefined {
  if (state.staged === undefined) return undefined
  return state.stations.find(station => station.stationId === state.staged)?.name
}

/**
 * Контроллер пикера: список — station.list (свои станции вызывающего на
 * хосте), выбор — локальная отложенная настройка экрана.
 */
export class ExecutionTargetController {
  /** Снимок пикера (источник хука рендера). */
  readonly store: SnapshotStore<ExecutionTargetState> = createSnapshotStore(INITIAL_EXECUTION_TARGET)

  /**
   * @param api - транспорт станций.
   */
  constructor(private readonly api: Pick<IApiClient, 'stations'>) {}

  /** Прочитать список своих станций; недоступный мост — чип скрывается. */
  async load(): Promise<void> {
    this.store.update((state) => {
      if (state.status === 'idle') state.status = 'loading'
    })
    const response = await this.api.stations.list({})
    if (!response.result.ok) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = response.result.error.message
        state.unavailable = response.result.error.code === 'stations-unavailable'
      })
      return
    }
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.stations = response.result.value.stations.map(station => ({
        stationId: station.stationId,
        name: station.name,
        online: station.online,
      }))
    })
  }

  /**
   * Отложить выбор исполнения для следующей сессии с этого экрана.
   * @param stationId - станция, или undefined для «Сервер».
   */
  stage(stationId: string | undefined): void {
    this.store.update((state) => {
      state.staged = stationId
    })
  }

  /**
   * Привязка для session.create: выбор «Сервер» не несёт ничего,
   * «Станция ⟨имя⟩» — её идентификатор.
   * @returns executionTarget для create, или undefined.
   */
  stagedTarget(): { stationId: string } | undefined {
    const staged = this.store.getSnapshot().staged
    return staged === undefined ? undefined : { stationId: staged }
  }
}
