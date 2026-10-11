/**
 * Invariant companion for the worktree capability.
 * @module @deepseek-ai/dsh-worktree/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-worktree'

/** Cordis companion plugin name. */
export const name = 'worktree-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: each verb is one stateless child-process round trip whose
 * observations the git repository itself owns; the service keeps no event stream
 * or mutable runtime data beside its frozen config.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the worktree invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
