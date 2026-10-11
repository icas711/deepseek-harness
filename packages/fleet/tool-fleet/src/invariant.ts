/**
 * Invariant companion for the fleet tool consumer.
 * @module @deepseek-ai/dsh-tool-fleet/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-fleet'

/** Cordis companion plugin name. */
export const name = 'tool-fleet-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this model-facing adapter has no independent lifecycle stream; execution
 * observability belongs to the tool pipeline and fanout consistency to `@deepseek-ai/dsh-fleet`.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the fleet tool invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
