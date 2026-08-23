/**
 * Telemetry status row in General settings: the mounted backend's sharing
 * disclosure, a refresh control, and — where the deployment can change it at
 * runtime — a mode selector writing the `session-telemetry` settings section.
 *
 * @module @deepseek-ai/dsh-client-ui-telemetry-status/client/TelemetryStatusRow
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14, IconRefreshOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TelemetryStatusState, TelemetryMode } from './store.ts'
import type { TelemetryStatusKey } from './locales.ts'
import css from './TelemetryStatusRow.module.css'

/** Registration-side business face for the telemetry status. */
export interface TelemetryStatusRowInjected {
  hooks: {
    /** Telemetry status snapshot bound by the renderer as useTelemetryStatus. */
    telemetryStatus: SnapshotStore<TelemetryStatusState>
  }
  /** Re-read the host disclosure. */
  load: () => Promise<void>
  /** Persist one capture mode through the settings section. */
  select: (mode: TelemetryMode) => Promise<void>
}

/** Full component props. */
export type TelemetryStatusRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'telemetryStatus'>
  & InjectFace<TelemetryStatusRowInjected>

/** The selectable modes with their label and description keys. */
const MODES: ReadonlyArray<{ id: TelemetryMode; labelKey: TelemetryStatusKey; descKey: TelemetryStatusKey }> = [
  { id: 'DISABLED', labelKey: 'telemetryStatus.disabled', descKey: 'telemetryStatus.disabledDesc' },
  { id: 'FEEDBACK_ONLY', labelKey: 'telemetryStatus.feedbackOnly', descKey: 'telemetryStatus.feedbackOnlyDesc' },
  { id: 'FULL', labelKey: 'telemetryStatus.full', descKey: 'telemetryStatus.fullDesc' },
]

/**
 * Render the telemetry status row.
 *
 * Displays the current sharing mode the host disclosed, a refresh control
 * for the disclosure, and a mode selector where the deployment applies mode
 * changes live. A host without a telemetry backend renders the explanatory
 * text only.
 *
 * @param props - composed slot props with translate function and injected controller face.
 * @returns the settings row.
 */
export function TelemetryStatusRow({ load, select, useTelemetryStatus, t }: TelemetryStatusRowProps) {
  const state = useTelemetryStatus(snapshot => snapshot)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (state.status !== 'saving' && state.status !== 'loading') return
    setOpen(false)
  }, [state.status])

  const busy = state.status === 'loading' || state.status === 'saving'
  const value = state.value
  const selected = value === null
    ? undefined
    : MODES.find(mode => mode.id === value.configuredMode)
  const description = state.status === 'unavailable'
    ? t('telemetryStatus.unavailable')
    : selected === undefined
      ? t('telemetryStatus.description')
      : t(selected.descKey)
  const statusLine = selected === undefined ? undefined : t(selected.labelKey)

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('telemetryStatus.label')}</div>
        <div className={css.desc} role={state.error === null ? undefined : 'alert'}>
          {state.error ?? description}
        </div>
      </div>
      <button
        type="button"
        className={css.refresh}
        aria-label={t('telemetryStatus.refresh')}
        title={t('telemetryStatus.refresh')}
        disabled={busy}
        onClick={() => { void load() }}
      >
        <IconRefreshOutline14 className={busy ? css.spinning : undefined} />
      </button>
      {value !== null && value.changeable
        ? (
          <Menu
            open={open}
            onClose={() => { setOpen(false) }}
            items={MODES.map(mode => ({ id: mode.id, label: t(mode.labelKey) }))}
            selectedId={value.configuredMode}
            onSelect={(id) => {
              setOpen(false)
              void select(id as TelemetryMode)
            }}
            align="end"
            portal
            anchor={(
              <button
                type="button"
                className={css.selector}
                aria-haspopup="menu"
                aria-expanded={open}
                disabled={busy}
                onClick={() => { setOpen(!open) }}
              >
                {statusLine}
                <IconChevronDownOutline14 className={css.chevron} />
              </button>
            )}
          />
        )
        : statusLine === undefined ? null : <span className={css.status}>{statusLine}</span>}
    </div>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Telemetry status row copy. */
    telemetryStatus: TelemetryStatusKey
  }
}
