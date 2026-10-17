/**
 * Сопутствующий плагин инвариантов пакета @deepseek-ai/dsh-stations.
 * @module @deepseek-ai/dsh-stations/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-stations'

/** Имя сопутствующего плагина Cordis. */
export const name = 'stations-invariant'
/** Сервис, необходимый перед бронированием владения пакетом. */
export const inject = ['invariants']

/**
 * No runtime invariant: связи сервиса (мост ⇄ сессия ⇄ запись реестра)
 * привязаны к живым соединениям и потому кратковременны; подмена сессии,
 * гашение кода сопряжения и изоляция путей доказаны юнит- и
 * интеграционными тестами пакета на реальном сокете.
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
