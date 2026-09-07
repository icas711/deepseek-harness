/**
 * General Settings row for the DeepSeek provider's model-request retry
 * policy: the finite retry budget and the bounded exponential backoff (the
 * initial pause doubling up to the maximum). The values live in the shared
 * `llm-deepseek` settings section, so a saved policy reaches the next model
 * request without a restart; the row edits only what that section owns and
 * `settings.yaml` composition entries stay authoritative underneath.
 */
import { useState } from 'react'
import type {
  ObservableSnapshot, SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelsKey } from './locales.ts'
import shared from './ModelsSection.module.css'
import css from './RetrySettingsRow.module.css'

/** The three policy numbers this row edits. */
export interface RetryPolicyValues {
  /** Retries scheduled after the first failed request. */
  maxRetries: number
  /** First backoff pause in milliseconds; each retry doubles it. */
  initialDelayMs: number
  /** Pause ceiling in milliseconds. */
  maxDelayMs: number
}

/** Registration-side face. */
export interface RetrySettingsRowInjected {
  hooks: {
    /**
     * The `llm-deepseek` namespace mirror (auto-refreshing scope snapshot);
     * the renderer binds it as useProvider.
     */
    provider: ObservableSnapshot<SettingsScopeSnapshot<unknown>>
  }
  /**
   * Persist one edited policy into the shared section's user layer.
   * @param values - the parsed draft.
   * @returns the failure text, or undefined when the section accepted the write.
   */
  saveRetryPolicy: (values: RetryPolicyValues) => Promise<string | undefined>
  /**
   * Clear the user-layer `retryPolicy` override, so the composition entry —
   * and then the adapter defaults — owns the policy again.
   * @returns the failure text, or undefined when the write landed.
   */
  resetRetryPolicy: () => Promise<string | undefined>
}

/** Full Settings-row props: runtime share + locale seat + injected face. */
export type RetrySettingsRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.models'>
  & InjectFace<RetrySettingsRowInjected>

/** The resolved policy facts this row renders. */
export interface ResolvedRetryPolicy extends RetryPolicyValues {
  /** `always` mode: the finite budget below does not apply. */
  alwaysMode: boolean
}

/** Schema defaults of a normal policy (`dsh-llm` resolveRetryPolicy). */
const DEFAULT_MAX_RETRIES = 5
const DEFAULT_INITIAL_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 10_000

/** What a ready section without a `retryPolicy` record offers: the schema default, editable. */
const SCHEMA_DEFAULT_POLICY: ResolvedRetryPolicy = {
  alwaysMode: false,
  maxRetries: DEFAULT_MAX_RETRIES,
  initialDelayMs: DEFAULT_INITIAL_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the retry policy out of a resolved settings section. Every field falls
 * back to its schema default, so a partial composition entry still renders a
 * complete policy.
 * @param section - the resolved `llm-deepseek` section.
 * @returns the policy, or undefined when the section carries none.
 */
export function resolvedPolicy(section: unknown): ResolvedRetryPolicy | undefined {
  if (!isRecord(section) || !isRecord(section.retryPolicy)) return undefined
  const policy = section.retryPolicy
  const backoff = isRecord(policy.backoff) ? policy.backoff : {}
  return {
    alwaysMode: policy.mode === 'always',
    maxRetries: typeof policy.maxRetries === 'number' ? policy.maxRetries : DEFAULT_MAX_RETRIES,
    initialDelayMs: typeof backoff.initialDelayMs === 'number'
      ? backoff.initialDelayMs
      : DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs: typeof backoff.maxDelayMs === 'number' ? backoff.maxDelayMs : DEFAULT_MAX_DELAY_MS,
  }
}

/** The three fields as typed. */
type RetryDraft = Record<keyof RetryPolicyValues, string>

/**
 * Parse the text draft into the wire values.
 * @param draft - the fields as typed.
 * @returns the values, or the copy key naming what is wrong.
 */
export function parseRetryDraft(
  draft: RetryDraft,
): { kind: 'values'; values: RetryPolicyValues } | { kind: 'invalid'; reason: ModelsKey } {
  const numbers: number[] = []
  for (const raw of [draft.maxRetries, draft.initialDelayMs, draft.maxDelayMs]) {
    const value = Number(raw)
    if (raw.trim() === '' || !Number.isInteger(value) || value < 0) {
      return { kind: 'invalid', reason: 'retriesInvalid' }
    }
    numbers.push(value)
  }
  const [maxRetries = 0, initialDelayMs = 0, maxDelayMs = 0] = numbers
  if (initialDelayMs > maxDelayMs) return { kind: 'invalid', reason: 'retriesInvalid' }
  return {
    kind: 'values',
    values: { maxRetries, initialDelayMs, maxDelayMs },
  }
}

/**
 * Render the retry-policy preference row.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function RetrySettingsRow({
  t, useProvider, saveRetryPolicy, resetRetryPolicy,
}: RetrySettingsRowProps) {
  const snapshot = useProvider(s => s)
  const resolved = snapshot.status === 'ready' ? resolvedPolicy(snapshot.value) : undefined
  const asDraft = (policy: ResolvedRetryPolicy): RetryDraft => ({
    maxRetries: String(policy.maxRetries),
    initialDelayMs: String(policy.initialDelayMs),
    maxDelayMs: String(policy.maxDelayMs),
  })
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  // The text draft is component-local; every accepted Host view (a revision
  // bump from this row's own write, another surface, or settings.yaml)
  // resets it — the same committed-baseline discipline as the provider card.
  const [draft, setDraft] = useState<RetryDraft | undefined>(undefined)
  const [viewedRevision, setViewedRevision] = useState(snapshot.revision)
  if (snapshot.revision !== viewedRevision) {
    setViewedRevision(snapshot.revision)
    setDraft(undefined)
    setSaved(false)
    setFailure(undefined)
  }

  const shown = draft ?? asDraft(resolved ?? SCHEMA_DEFAULT_POLICY)
  const parsed = parseRetryDraft(shown)
  const locked = (resolved?.alwaysMode ?? false) || !snapshot.writable
  const inputDisabled = locked || busy

  const apply = async (): Promise<void> => {
    /* v8 ignore next -- the Apply button is disabled unless the draft parses; the guard keeps a future caller from persisting one. */
    if (parsed?.kind !== 'values') return
    setBusy(true)
    setFailure(undefined)
    try {
      const error = await saveRetryPolicy(parsed.values)
      if (error !== undefined) {
        setFailure(error)
        return
      }
      setSaved(true)
      setDraft(undefined)
    } catch (error: unknown) {
      // A transport failure rejects without a structured answer; surface it
      // instead of leaving the row busy.
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const reset = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const error = await resetRetryPolicy()
      if (error !== undefined) {
        setFailure(error)
        return
      }
      setSaved(false)
      setDraft(undefined)
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const field = (key: keyof RetryPolicyValues, label: ModelsKey) => (
    <label className={`${shared['field']} ${css.field}`}>
      <span className={shared['fieldLabel']}>{t(label)}</span>
      <input
        className={shared['input']}
        inputMode="numeric"
        autoComplete="off"
        value={shown[key]}
        disabled={inputDisabled}
        aria-label={t(label)}
        onChange={(event) => {
          setSaved(false)
          setFailure(undefined)
          setDraft({ ...shown, [key]: event.target.value })
        }}
      />
    </label>
  )

  return (
    <div className={css.row}>
      <div className={css.header}>
        <div className={css.title}>{t('retriesTitle')}</div>
        <div className={css.desc}>{t('retriesDesc')}</div>
      </div>
      {snapshot.status !== 'ready'
        ? <p className={css.note}>{t('retriesUnavailable')}</p>
        : (
          <>
            {resolved?.alwaysMode === true && <p className={css.note}>{t('retriesAlways')}</p>}
            <div className={css.fields}>
              {field('maxRetries', 'retriesCount')}
              {field('initialDelayMs', 'retriesInitial')}
              {field('maxDelayMs', 'retriesMax')}
            </div>
            {draft !== undefined && parsed?.kind === 'invalid' && (
              <p className={shared['error']}>{t(parsed.reason)}</p>
            )}
            {failure !== undefined && <p className={shared['error']}>{failure}</p>}
            {saved && failure === undefined && <p className={css.note}>{t('retriesSaved')}</p>}
            <div className={css.actions}>
              <button
                type="button"
                className={shared['secondaryButton']}
                disabled={inputDisabled}
                onClick={() => { void reset() }}
              >
                {t('retriesReset')}
              </button>
              <button
                type="button"
                className={shared['primaryButton']}
                disabled={draft === undefined || parsed?.kind !== 'values' || inputDisabled}
                onClick={() => { void apply() }}
              >
                {busy ? t('retriesApplying') : t('retriesApply')}
              </button>
            </div>
          </>
        )}
    </div>
  )
}
