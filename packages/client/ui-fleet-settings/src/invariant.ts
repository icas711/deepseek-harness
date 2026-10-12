/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-fleet-settings`.
 * @module @deepseek-ai/dsh-client-ui-fleet-settings/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-fleet-settings'

/** Cordis companion plugin name. */
export const name = 'client-ui-fleet-settings-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this is a browser-side surface plugin whose node half owns no event stream
 * or mutable runtime data; the limits read and write are host contracts covered there.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
