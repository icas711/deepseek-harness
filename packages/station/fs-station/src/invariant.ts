/**
 * Сопутствующий плагин инвариантов пакета @deepseek-ai/dsh-fs-station.
 * @module @deepseek-ai/dsh-fs-station/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fs-station'

/** Имя сопутствующего плагина Cordis. */
export const name = 'fs-station-invariant'
/** Сервис, необходимый перед бронированием владения пакетом. */
export const inject = ['invariants']

/**
 * No runtime invariant: провайдер не ведёт собственного состояния поверх
 * моста — каждая операция возвращает committed-результат станции; изоляция
 * путей и гварды версий доказаны юнит-тестами на живом мосту.
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
