/**
 * Connection health: the coarse process-reachability face the chat surfaces
 * read. The runtime apply publishes one store instance as the
 * `connectionHealth` service; presentation packages consume it through the
 * inject `hooks` compartment, never the service object.
 */
import { createSnapshotStore } from './contract/store.ts'
import type { SnapshotStore } from './contract/store.ts'

/**
 * Process reachability as the connection layer reports it. `'connecting'` is
 * the initial span before the first generation lands — deliberately distinct
 * from `'reconnecting'`, so UI chrome can stay quiet during a normal boot and
 * speak only about a connection that was up and then died.
 */
export type ConnectionHealth = 'connecting' | 'connected' | 'reconnecting'

/**
 * Create the health store the runtime publishes as `connectionHealth`.
 * Sync flush: a generation death must repaint the banner in the same tick it
 * invalidates session state.
 * @returns the store.
 */
export function createConnectionHealthStore(): SnapshotStore<ConnectionHealth> {
  return createSnapshotStore<ConnectionHealth>('connecting')
}
