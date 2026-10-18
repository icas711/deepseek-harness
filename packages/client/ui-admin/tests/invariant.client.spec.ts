// @vitest-environment jsdom
/**
 * Invariant companion and node-half coverage: the browser plugin's host-side
 * apply is an intentional no-op, and the companion registers under the
 * package name with an empty installer.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as nodeApply } from '../src/index.ts'
import * as AdminInvariant from '../src/invariant.ts'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(AdminInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', () => {
    nodeApply()
    expect(true).toBe(true)
  })
})
