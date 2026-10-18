/**
 * Сопутствующий плагин инвариантов пакета @deepseek-ai/dsh-station-protocol.
 * @module @deepseek-ai/dsh-station-protocol/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-station-protocol'

/** Имя сопутствующего плагина Cordis. */
export const name = 'station-protocol-invariant'
/** Сервис, необходимый перед бронированием владения пакетом. */
export const inject = ['invariants']

/**
 * No runtime invariant: чистая библиотека кодека и проверки путей без
 * собственного состояния и событий; полнота декодера и изоляция путей
 * доказаны юнит-тестами пакета на обеих платформенных ветках.
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
