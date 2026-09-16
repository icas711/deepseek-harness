// Process-reachability strip above the conversation body. Renders nothing
// while the connection is healthy — including the initial `'connecting'`
// span, which is a normal boot, not an outage.

import type { ConnectionBannerSlotProps } from '../contract/slots.ts'
import css from './ConnectionBanner.module.css'

/** Full props composed from the slot contract. */
export type ConnectionBannerProps = ConnectionBannerSlotProps

/**
 * The banner seat's resident component: a persistent strip while the backend
 * process is unreachable, gone the moment a connection generation lands.
 */
export function ConnectionBanner({ useConnectionHealth, t }: ConnectionBannerProps) {
  const health = useConnectionHealth(s => s)
  if (health !== 'reconnecting') return null
  return (
    <div className={css.strip} role="status">
      {t('connection.down')}
    </div>
  )
}
