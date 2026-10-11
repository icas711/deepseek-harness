/**
 * Loader fixture that holds the fleet owner's second step until the fleet
 * service delivers the member's completion notice into the owner inbox, so the
 * notice's event position and the observed member state stay deterministic
 * across platforms regardless of git subprocess latency.
 * @module fleet-snapshot-fence
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-fleet'

/** Fixture plugin name. */
export const name = 'fleet-snapshot-fence'

/**
 * Fence the owner's step 2 behind admission of the fleet completion notice.
 *
 * The held pre-step runs after its own `Inbox.claim()`, so the notice lands
 * after step 2's claim and is claimed at step 3; the status tool at step 2 then
 * always observes the member `idle`, because the member's single scripted turn
 * has ended before the owner's second model call.
 * @param ctx - assembled headless-agent context.
 */
export function apply(ctx: Context): void {
  const delivered = Promise.withResolvers<undefined>()
  let hasDelivered = false

  ctx.effect(() => {
    const disposeInbox = ctx.root.on('agent/inbox/inserted', ({ agent, message }) => {
      if (agent.session.header.parentSession !== undefined) return
      const text = message.content.find(block => block.type === 'text')
      if (message.source.kind !== 'user' || text === undefined || !text.text.startsWith('fleet ')) return
      hasDelivered = true
      delivered.resolve(undefined)
    })
    const disposeStep = ctx.root.on('agent/pre-step', async ({ agent, turn, step }, next) => {
      if (agent.session.header.parentSession === undefined && turn === 1 && step === 2 && !hasDelivered) {
        await delivered.promise
      }
      return next()
    })
    return () => {
      disposeStep()
      disposeInbox()
    }
  }, 'fleet-snapshot-fence.listeners')
}
