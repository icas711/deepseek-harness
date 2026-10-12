/**
 * Fleet limits controller: reads the `fleet` settings namespace view the host
 * serves and persists limit changes through `settings.update` with the
 * revision the view was read at. One store, two wire calls — `settings.describe`
 * for the read, `settings.update` for the write — and the write's response is
 * the row's next truth: the host's own resolved view, never a predicted echo.
 */

import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The fleet settings namespace on the host wire. */
export const FLEET_SETTINGS_NS = 'fleet'

/** The limits the fleet service enforces, as the settings view carries them. */
export interface FleetLimitsValue {
  /** Maximum attempts one fanout may start. */
  maxMembers: number
  /** Maximum `delegationDepth` a session may fan out at. */
  maxFanoutDepth: number
}

/** Row snapshot: the limits, the request state, or why neither is available. */
export interface FleetLimitsState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'error'
  error: string | null
  value: FleetLimitsValue | null
  /** Whether the served document accepts writes right now. */
  writable: boolean
}

const INITIAL: FleetLimitsState = { status: 'idle', error: null, value: null, writable: false }

/**
 * Read the limits out of one namespace view's resolved value. The host schema
 * guarantees two finite numbers; a shape that fails this guard is wire
 * corruption the row reports instead of rendering.
 * @param value - the view's resolved `value`.
 * @returns the limits, or null when the view does not carry them.
 */
export function limitsOf(value: unknown): FleetLimitsValue | null {
  if (typeof value !== 'object' || value === null) return null
  const { maxMembers, maxFanoutDepth } = value as Record<string, unknown>
  if (typeof maxMembers !== 'number' || typeof maxFanoutDepth !== 'number') return null
  return { maxMembers, maxFanoutDepth }
}

/**
 * Human text for a rejected wire call. A transport failure rejects with an
 * Error; a host or a runtime can reject with anything, and the surface still
 * has to say something.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Reads the fleet limits view and persists changes. */
export class FleetLimitsController {
  /** Row snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<FleetLimitsState> = createSnapshotStore(INITIAL)

  private generation = 0
  private view: SettingsNamespaceView | undefined

  /** @param api - settings wire face. */
  constructor(private readonly api: Pick<IApiClient, 'settings'>) {}

  private set(patch: Partial<FleetLimitsState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /** Store one served view as the row's truth. */
  private accept(view: SettingsNamespaceView, writable: boolean): void {
    this.view = view
    const value = limitsOf(view.value)
    if (value === null) {
      this.set({ status: 'error', error: 'fleet: settings view is malformed', value: null, writable: false })
      return
    }
    this.set({ status: 'ready', error: null, value, writable })
  }

  /**
   * Read the served settings views. A composition without the fleet namespace
   * is valid, not a failure: the row reports `unavailable`. Latest request
   * wins; a response from a superseded request publishes nothing.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    const before = this.store.getSnapshot()
    if (before.status === 'loading') return
    const generation = ++this.generation
    this.set({ status: 'loading', error: null })
    try {
      const response = await this.api.settings.describe({})
      if (generation !== this.generation) return
      if (!response.result.ok) {
        this.set({ status: 'error', error: response.result.error.message })
        return
      }
      const view = response.result.value.namespaces.find(entry => entry.ns === FLEET_SETTINGS_NS)
      if (view === undefined) {
        this.view = undefined
        this.set({ status: 'unavailable', error: null, value: null, writable: false })
        return
      }
      this.accept(view, response.result.value.writable)
    } catch (error) {
      if (generation !== this.generation) return
      this.set({ status: 'error', error: messageOf(error) })
    }
  }

  /**
   * Persist both limits. The write targets the namespace the fleet service
   * resolves live, so the change applies to the next fanout without a
   * restart; the response view is the row's next truth, including a refusal's
   * unchanged one.
   * @param next - the limits to store.
   * @returns once the write settled.
   */
  async save(next: FleetLimitsValue): Promise<void> {
    const view = this.view
    if (view === undefined || !this.store.getSnapshot().writable) return
    if (this.store.getSnapshot().status === 'saving') return
    const generation = ++this.generation
    this.set({ status: 'saving', error: null })
    try {
      const response = await this.api.settings.update({
        ns: FLEET_SETTINGS_NS,
        patch: { ...next },
        expectedRevision: view.revision,
      })
      if (generation !== this.generation) return
      if (!response.result.ok) {
        this.set({ status: 'ready', error: response.result.error.message })
        return
      }
      this.accept(response.result.value, true)
    } catch (error) {
      if (generation !== this.generation) return
      this.set({ status: 'ready', error: messageOf(error) })
    }
  }

  /** Stop in-flight responses from publishing after plugin disposal. */
  dispose(): void {
    this.generation += 1
    this.view = undefined
  }
}
