/**
 * Сопутствующий плагин инвариантов пакета @deepseek-ai/dsh-station-connector.
 * @module @deepseek-ai/dsh-station-connector/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-station-connector'

/** Имя сопутствующего плагина Cordis. */
export const name = 'station-connector-invariant'
/** Сервис, необходимый перед бронированием владения пакетом. */
export const inject = ['invariants']

/**
 * No runtime invariant: коннектор — самостоятельное приложение без Cordis-
 * дерева; его гарантии (изоляция путей на исполнителе, порядок stdout →
 * exit, гашение процессов при останове) держатся на юнит- и интеграционных
 * тестах с реальным сокетом, а не на внутрипроцессных событиях.
 */
const install: InvariantInstaller = () => {}

/**
 * Регистрирует сопутствующий плагин инвариантов пакета.
 * @param ctx - контекст Cordis с сервисом инвариантов.
 * @returns диспозер регистрации после успешной установки.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
