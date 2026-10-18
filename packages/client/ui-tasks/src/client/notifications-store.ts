/**
 * Контроллер раздела «Уведомления»: статус привязки логина к Telegram и
 * выдача одноразового кода через notifier.beginBinding. Подтверждение
 * приходит провайдеру от пользователя (команда бота), поэтому раздел только
 * показывает код — статус обновляется перечитыванием.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Снимок раздела «Уведомления». */
export interface NotificationsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Привязан ли логин вызывающего к получателю уведомлений. */
  bound: boolean
  /** Выданный одноразовый код (показывается до закрытия карточки). */
  code: string | null
  /** Прямо сейчас идёт запрос кода или статуса. */
  busy: boolean
  /** Текст последней неудачи. */
  error: string | null
}

/** Начальный снимок. */
export const INITIAL_NOTIFICATIONS: NotificationsState = {
  status: 'idle',
  bound: false,
  code: null,
  busy: false,
  error: null,
}

/**
 * Контроллер раздела: статус читается notifier.status, код выдаётся
 * notifier.beginBinding (адресуется логину веб-личности на хосте).
 */
export class NotificationsController {
  /** Снимок раздела (источник хука рендера). */
  readonly store: SnapshotStore<NotificationsState> = createSnapshotStore(INITIAL_NOTIFICATIONS)

  /**
   * @param api - транспорт уведомлений.
   */
  constructor(private readonly api: Pick<IApiClient, 'notifier'>) {}

  /** Прочитать статус привязки. */
  async load(): Promise<void> {
    this.store.update((state) => {
      if (state.status === 'idle') state.status = 'loading'
      state.busy = true
    })
    const response = await this.api.notifier.status({})
    this.store.update((state) => {
      state.busy = false
      if (!response.result.ok) {
        state.status = 'error'
        state.error = response.result.error.message
        return
      }
      state.status = 'ready'
      state.error = null
      state.bound = response.result.value.bound
    })
  }

  /**
   * Запросить одноразовый код привязки. Код адресуется логину вызывающего;
   * пока карточка открыта, статус намеренно не перепроверяется — подтверждение
   * делает пользователь в Telegram.
   */
  async beginBinding(): Promise<void> {
    this.store.update((state) => {
      state.busy = true
      state.error = null
    })
    const response = await this.api.notifier.beginBinding({})
    this.store.update((state) => {
      state.busy = false
      if (!response.result.ok) {
        state.error = response.result.error.message
        return
      }
      state.code = response.result.value.code
    })
  }

  /** Закрыть карточку кода. */
  dismissCode(): void {
    this.store.update((state) => {
      state.code = null
    })
  }
}
