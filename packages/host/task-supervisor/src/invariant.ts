/** Package-owned invariant companion. @module @deepseek-ai/dsh-task-supervisor/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-task-supervisor'

/** Cordis companion plugin name. */
export const name = 'task-supervisor-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package's guarantees are the durable file
 * round-trip, the writer-lock merge, and the transition table — medium and
 * lifecycle effects proven by the package's unit and real-composition
 * tests. The supervisor exposes no continuously observable in-process
 * event relation of its own; the model-visible continuation rides the
 * ordinary logged `user/message`, whose log relation `dsh-agent` owns.
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
