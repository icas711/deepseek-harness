/**
 * Invariant companion for the fleet orchestration service.
 * @module @deepseek-ai/dsh-fleet/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fleet'

/** Cordis companion plugin name. */
export const name = 'fleet-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: fanout records are process-local state whose consistency
 * with the agent registry the service checks on every read; member sessions and
 * worktrees carry their own authoritative stores (session log, git repository).
 */
const install: InvariantInstaller = () => {}

/**
 * Register the fleet invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
