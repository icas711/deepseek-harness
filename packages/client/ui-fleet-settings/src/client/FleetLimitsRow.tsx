/**
 * Fleet limits row in General settings: two integer fields — the per-fanout
 * attempt cap and the delegation-depth ceiling — reading the `fleet` settings
 * namespace and writing changes that apply to the next fanout live.
 *
 * @module @deepseek-ai/dsh-client-ui-fleet-settings/client/FleetLimitsRow
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FleetLimitsState, FleetLimitsValue } from './store.ts'
import { copyText } from './clipboard.ts'
import type { FleetLimitsKey } from './locales.ts'
import css from './FleetLimitsRow.module.css'

/** Registration-side business face for the fleet limits. */
export interface FleetLimitsRowInjected {
  hooks: {
    /** Limits snapshot bound by the renderer as useFleetLimits. */
    fleetLimits: SnapshotStore<FleetLimitsState>
  }
  /** Re-read the served settings views. */
  load: () => Promise<void>
  /** Persist both limits through the settings namespace. */
  save: (next: FleetLimitsValue) => Promise<void>
}

/** Full component props. */
export type FleetLimitsRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'fleetLimits'>
  & InjectFace<FleetLimitsRowInjected>

/** One field's editable text, kept as typed until the host value moves. */
interface Draft {
  maxMembers: string
  maxFanoutDepth: string
}

/** The usage examples, as the settings row teaches the chat phrasing. */
const EXAMPLES: ReadonlyArray<{ titleKey: FleetLimitsKey; textKey: FleetLimitsKey }> = [
  { titleKey: 'fleetLimits.exampleParallelTitle', textKey: 'fleetLimits.exampleParallelText' },
  { titleKey: 'fleetLimits.exampleSplitTitle', textKey: 'fleetLimits.exampleSplitText' },
  { titleKey: 'fleetLimits.exampleCompareTitle', textKey: 'fleetLimits.exampleCompareText' },
]

/**
 * Render the fleet limits row.
 *
 * Shows the current limits as two integer inputs and an apply control writing
 * the `fleet` settings section; a composition without the fleet service
 * renders the explanatory text only.
 *
 * @param props - composed slot props with translate function and injected controller face.
 * @returns the settings row.
 */
export function FleetLimitsRow({ load, save, useFleetLimits, t }: FleetLimitsRowProps) {
  const state = useFleetLimits(snapshot => snapshot)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  // The host value is the anchor: an external edit (another tab, the document
  // opened on the host) replaces a draft that has not been applied.
  useEffect(() => {
    if (state.value === null) return
    setDraft({ maxMembers: String(state.value.maxMembers), maxFanoutDepth: String(state.value.maxFanoutDepth) })
    setInvalid(false)
  }, [state.value])

  const busy = state.status === 'loading' || state.status === 'saving'
  const value = state.value
  const current = draft ?? (value === null ? null : { maxMembers: String(value.maxMembers), maxFanoutDepth: String(value.maxFanoutDepth) })
  const dirty = value !== null && current !== null
    && (Number(current.maxMembers) !== value.maxMembers || Number(current.maxFanoutDepth) !== value.maxFanoutDepth)

  const edit = (field: keyof Draft, text: string): void => {
    /* v8 ignore next -- reachable only while a value exists; the fields render only then */
    if (current === null) return
    setDraft({ ...current, [field]: text })
    setInvalid(false)
  }

  const apply = (): void => {
    /* v8 ignore next -- reachable only while a value exists; the apply control renders only then */
    if (current === null) return
    const maxMembers = Number(current.maxMembers)
    const maxFanoutDepth = Number(current.maxFanoutDepth)
    const empty = current.maxMembers.trim() === '' || current.maxFanoutDepth.trim() === ''
    if (empty || !Number.isInteger(maxMembers) || !Number.isInteger(maxFanoutDepth)) {
      setInvalid(true)
      return
    }
    void save({ maxMembers, maxFanoutDepth })
  }

  const copyExample = (text: string): void => {
    void copyText(text).catch(() => {
      // The clipboard stayed unavailable; the prompt remains on screen for manual selection.
    })
  }

  return (
    <div className={css.block}>
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('fleetLimits.label')}</div>
          <div className={css.desc} role={state.error === null && !invalid ? undefined : 'alert'}>
            {invalid ? t('fleetLimits.invalid') : state.error ?? (state.status === 'unavailable' ? t('fleetLimits.unavailable') : t('fleetLimits.description'))}
          </div>
          <button
            type="button"
            className={css.usage}
            aria-expanded={usageOpen}
            onClick={() => { setUsageOpen(!usageOpen) }}
          >
            {t('fleetLimits.usage')}
          </button>
        </div>
        <button
          type="button"
          className={css.refresh}
          aria-label={t('fleetLimits.refresh')}
          title={t('fleetLimits.refresh')}
          disabled={busy}
          onClick={() => { void load() }}
        >
          <IconRefreshOutline14 className={busy ? css.spinning : undefined} />
        </button>
        {value !== null && current !== null
          ? (
            <div className={css.fields}>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('fleetLimits.maxMembers')}</span>
                <input
                  className={css.input}
                  type="number"
                  min={1}
                  step={1}
                  aria-label={t('fleetLimits.maxMembers')}
                  disabled={busy || !state.writable}
                  value={current.maxMembers}
                  onChange={(event) => { edit('maxMembers', event.target.value) }}
                />
              </label>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('fleetLimits.maxFanoutDepth')}</span>
                <input
                  className={css.input}
                  type="number"
                  min={0}
                  step={1}
                  aria-label={t('fleetLimits.maxFanoutDepth')}
                  disabled={busy || !state.writable}
                  value={current.maxFanoutDepth}
                  onChange={(event) => { edit('maxFanoutDepth', event.target.value) }}
                />
              </label>
              <button
                type="button"
                className={css.apply}
                disabled={busy || !state.writable || !dirty || invalid}
                onClick={apply}
              >
                {t('fleetLimits.apply')}
              </button>
            </div>
          )
          : null}
      </div>
      {usageOpen
        ? (
          <div className={css.examples}>
            <div className={css.intro}>{t('fleetLimits.usageIntro')}</div>
            {EXAMPLES.map(example => (
              <div key={example.titleKey} className={css.example}>
                <div className={css.exampleTitle}>{t(example.titleKey)}</div>
                <div className={css.exampleText}>{t(example.textKey)}</div>
                <button
                  type="button"
                  className={css.copy}
                  onClick={() => { copyExample(t(example.textKey)) }}
                >
                  {t('fleetLimits.copy')}
                </button>
              </div>
            ))}
          </div>
        )
        : null}
    </div>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Fleet limits row copy. */
    fleetLimits: FleetLimitsKey
  }
}
