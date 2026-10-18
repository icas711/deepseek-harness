/**
 * Контроллер видимости страницы «Задачи»: корневое состояние просмотра,
 * общее для кнопки панели, overlay-страницы и deep-link'а /tasks. Разделён с
 * контроллером данных (store.ts): видимость — просмотр, задачи — хост.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Снимок видимости страницы. */
export interface TasksUiState {
  /** Страница открыта поверх рабочей области. */
  open: boolean
}

/** Начальный снимок. */
export const INITIAL_UI_STATE: TasksUiState = { open: false }

/**
 * Контроллер видимости: открыт/закрыт. Инстанс один на плагин и разделяется
 * обеими регистрациями через inject.
 */
export class TasksUiController {
  /** Снимок видимости (источник хука рендера). */
  readonly store: SnapshotStore<TasksUiState> = createSnapshotStore(INITIAL_UI_STATE)

  /** Открыть страницу. */
  open(): void {
    this.store.update((state) => {
      state.open = true
    })
  }

  /** Закрыть страницу. */
  close(): void {
    this.store.update((state) => {
      state.open = false
    })
  }
}
