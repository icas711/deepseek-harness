/**
 * Плагин страницы «Администрирование», браузерная половина. Секция настроек
 * «Администрирование» регистрируется только когда вызвавший веб-пользователь —
 * админ (ответ admin.status); сокрытие на клиенте — удобство, подлинную
 * проверку роли выполняет хост на каждом методе admin.*. Перелогин
 * (connection/reset) перепроверяет статус и ставит/снимает секцию.
 *
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: словарный merge (ctx.locale) в этой программе.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: SlotMap-merge секций настроек ('settings.section').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { AdminSection } from './AdminSection.tsx'
import type { AdminSectionInjected } from './AdminSection.tsx'
import { AdminSectionController } from './store.ts'
import { ru, type AdminKey } from './locales.ts'

export type { AdminSectionInjected, AdminSectionProps } from './AdminSection.tsx'
export type { AdminKey } from './locales.ts'
export { INITIAL_STATE, draftError, generatePassword, messageOf } from './store.ts'
export type { AdminDeviceRow, AdminRole, AdminSectionState, AdminUserRow, CreateDraft, IssuedPassword } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Копия страницы «Администрирование». */
    'settings.admin': AdminKey
  }
}

/** Пространство словаря этого плагина. */
const NS = 'settings.admin'

/** Порядок секции в навигации настроек: после «Пресетов агента» (20). */
const SECTION_ORDER = 30

/** Требуемые сервисы (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection']

/**
 * Смонтировать страницу: словарь, проверку admin.status и условную секцию.
 * @param ctx - браузерный корневой контекст.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, ru), 'ui-admin: словари')

  const connection = ctx.get('connection') as ConnectionHandle
  const api = connection.api
  // Метка текущей проверки: гон двух status-запросов не должен оставлять два
  // регистра; каждая проверка отменяет хвост предыдущей.
  let evaluation = 0
  let disposeSection: (() => void) | undefined

  const unregister = (): void => {
    disposeSection?.()
    disposeSection = undefined
  }

  const evaluate = async (): Promise<void> => {
    const ticket = ++evaluation
    unregister()
    // Отказ проверки (обрыв связи) читается как «не админ»: страница не ставится.
    const response = await api.admin.status({}).catch(() => undefined)
    if (ticket !== evaluation || response === undefined) return
    const admin = response.result.ok && response.result.value.admin
    if (!admin) return
    const t = ctx.locale.bind(NS) as AdminSectionInjected['t']
    const controller = new AdminSectionController(api, t)
    const useSnapshot = bindSnapshotSelector(controller.store)
    const injected = (): AdminSectionInjected => ({ controller, useSnapshot, t })
    disposeSection = ctx.slots.register({
      name: 'settings.section',
      id: 'admin',
      order: SECTION_ORDER,
      label: () => t('nav'),
      locale: NS,
      inject: injected,
    }, AdminSection)
  }

  // Регистрация ждёт объявления settings.section через slots.inject (порядок
  // apply не ограничен), а фактическая установка — условная: не-админ секцию
  // не получает вовсе.
  ctx.slots.inject('settings.section', () => {
    void evaluate()
    return () => {
      evaluation += 1
      unregister()
    }
  })

  ctx.effect(() => {
    const offReset = ctx.on('connection/reset', () => { void evaluate() })
    return () => {
      offReset()
      evaluation += 1
      unregister()
    }
  }, 'ui-admin: перепроверка роли')
}
