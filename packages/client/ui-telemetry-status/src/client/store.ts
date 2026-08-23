/**
 * Telemetry status controller: reads the host's sharing disclosure and
 * persists mode changes through the settings namespace the host backend
 * resolves live. One store, two wire calls — `host.telemetryStatus` for the
 * disclosure, `settings.update` for the write — with the write re-reading
 * the disclosure so the row always renders the backend's own word, never a
 * predicted echo.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The telemetry settings namespace on the host wire. */
export const TELEMETRY_SETTINGS_NS = 'session-telemetry'

/** The serialized capture modes, as the host section and the disclosure carry them. */
export type TelemetryMode = 'DISABLED' | 'FEEDBACK_ONLY' | 'FULL'

/** The row's view of the host disclosure. */
export interface TelemetryStatusValue {
  /** Sharing policy the mounted backend currently runs. */
  sharing: 'disabled' | 'feedback-only' | 'full'
  /** Mode the settings section resolves to right now. */
  configuredMode: TelemetryMode
  /** Whether this deployment can change the mode without a restart. */
  changeable: boolean
}

/** Row snapshot: the disclosure, the request state, or why neither is available. */
export interface TelemetryStatusState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'error'
  error: string | null
  value: TelemetryStatusValue | null
}

const INITIAL: TelemetryStatusState = { status: 'idle', error: null, value: null }

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

/** Reads the disclosure and persists the telemetry mode. */
export class TelemetryStatusController {
  /** Row snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<TelemetryStatusState> = createSnapshotStore(INITIAL)

  constructor(private readonly api: IApiClient) {}

  private set(patch: Partial<TelemetryStatusState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Read the host disclosure. A host with no telemetry backend is a valid
   * composition, not a failure: the row reports `unavailable` and renders
   * only the explanatory text.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    const before = this.store.getSnapshot()
    if (before.status === 'loading') return
    this.set({ status: 'loading', error: null })
    try {
      const response = await this.api.host.telemetryStatus({})
      if (response.result.ok) {
        this.set({ status: 'ready', error: null, value: response.result.value })
        return
      }
      // The one refusal with its own rendering: no backend composed.
      if (response.result.error.code === 'telemetry-not-configured') {
        this.set({ status: 'unavailable', error: null, value: null })
        return
      }
      this.set({ status: 'error', error: response.result.error.message })
    } catch (error) {
      this.set({ status: 'error', error: messageOf(error) })
    }
  }

  /**
   * Persist one mode and re-read the disclosure. The write targets the
   * settings namespace the host backend resolves live, so the change applies
   * without a restart; the re-read lands on whatever the backend actually
   * mounted, including a refusal's unchanged value.
   * @param mode - the capture mode to select.
   * @returns once the write settled and the disclosure was re-read.
   */
  async select(mode: TelemetryMode): Promise<void> {
    const before = this.store.getSnapshot()
    if (before.status === 'saving') return
    if (before.value !== null && before.value.configuredMode === mode) return
    this.set({ status: 'saving', error: null })
    try {
      const response = await this.api.settings.update({
        ns: TELEMETRY_SETTINGS_NS,
        patch: { mode },
      })
      if (!response.result.ok) {
        this.set({ status: 'ready', error: response.result.error.message })
        return
      }
    } catch (error) {
      this.set({ status: 'ready', error: messageOf(error) })
      return
    }
    await this.load()
  }
}
