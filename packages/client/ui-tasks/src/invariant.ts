/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-tasks`.
 * @module @deepseek-ai/dsh-client-ui-tasks/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-tasks'

/** Cordis companion plugin name. */
export const name = 'client-ui-tasks-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: browser-side surface plugin over the gateway's tasks
 * and notifier domains; the served data and its isolation rules are host
 * contracts of dsh-task-supervisor, the notifier seam, and the api-proxy
 * domain layer.
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
