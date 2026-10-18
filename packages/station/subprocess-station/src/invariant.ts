/**
 * Сопутствующий плагин инвариантов пакета @deepseek-ai/dsh-subprocess-station.
 * @module @deepseek-ai/dsh-subprocess-station/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-subprocess-station'

/** Имя сопутствующего плагина Cordis. */
export const name = 'subprocess-station-invariant'
/** Сервис, необходимый перед бронированием владения пакетом. */
export const inject = ['invariants']

/**
 * No runtime invariant: провайдер держит только набор живых дескрипторов,
 * чья связь с событиями моста короткоживуща; порядок stdout → exit,
 * offset-чтение окон и эскалация terminate доказаны юнит- и
 * интеграционными тестами на реальном сокете.
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
