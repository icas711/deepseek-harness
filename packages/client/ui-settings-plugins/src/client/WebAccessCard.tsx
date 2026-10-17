/**
 * The web-access picker's card: one radio list for search and one for fetch,
 * each with the «Авто» option, the providers this deployment does not mount
 * rendered grey with their tag, and the warnings the seam's selection rules
 * predict for the staged pick.
 */

import { useId } from 'react'
import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CardFieldState } from './card-form.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import { PluginCard } from './PluginCard.tsx'
import type { WebAccessCardFace, WebProviderGroupState } from './web-access-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './WebAccessCard.module.css'

/** Props the renderer binds for the web-access card. */
export type WebAccessCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<WebAccessCardFace>

/** One radio option resolved for display. */
interface RadioOption {
  /** The seam's provider id, the radio's value. */
  id: string
  /** The resolved visible name. */
  label: string
  /** Whether this deployment mounts the provider's plugin. */
  mounted: boolean
}

/** One picker group resolved for display. */
interface RadioGroup {
  /** The staged-or-effective selection; the empty string is «Авто». */
  value: CardFieldState
  /** Every option, including the ones this deployment does not mount. */
  options: readonly RadioOption[]
}

/** One radio list over one picker group, plus its «Авто» option. */
function ProviderRadioGroup(props: {
  /** Radio group name keeping the group's options exclusive. */
  name: string
  /** Visible group label. */
  label: string
  /** The «Авто» option's copy. */
  autoLabel: string
  /** The unmounted provider's tag copy. */
  unmountedLabel: string
  /** Disables every radio (read-only document). */
  disabled: boolean
  /** The group's staged-or-effective value and resolved options. */
  group: RadioGroup
  /** Stage the picked id; the empty string picks «Авто». */
  onPick: (id: string) => void
}) {
  return (
    <fieldset className={css.group}>
      <legend className={css.groupLabel}>{props.label}</legend>
      {props.group.options.map(option => (
        <label
          key={option.id}
          className={clsx(css.option, !option.mounted && css.optionUnmounted)}
        >
          <input
            type="radio"
            name={props.name}
            value={option.id}
            checked={props.group.value.text === option.id}
            disabled={props.disabled}
            // Click, not change: re-clicking the already-selected provider is
            // the gesture that names its card, and a checked radio fires no
            // change event.
            onClick={() => { props.onPick(option.id) }}
          />
          <span className={css.optionName}>{option.label}</span>
          {!option.mounted ? <span className={css.optionTag}>{props.unmountedLabel}</span> : null}
        </label>
      ))}
      <label className={css.option}>
        <input
          type="radio"
          name={props.name}
          value=""
          checked={props.group.value.text === ''}
          disabled={props.disabled}
          onClick={() => { props.onPick('') }}
        />
        <span className={css.optionName}>{props.autoLabel}</span>
      </label>
    </fieldset>
  )
}

/** Resolve one group's locale keys into display copy. */
function resolvedGroup(group: WebProviderGroupState, t: (key: PluginsSettingsLocaleKey) => string): RadioGroup {
  return {
    value: group.value,
    options: group.options.map(option => ({ ...option, label: t(option.labelKey) })),
  }
}

/**
 * Render the web-access picker card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function WebAccessCard(props: WebAccessCardProps) {
  const { t } = props
  const state = props.useWebAccessCard(snapshot => snapshot)
  const searchName = useId()
  const fetchName = useId()
  return (
    <PluginCard
      t={t}
      titleKey="webAccessTitle"
      descriptionKey="webAccessDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ProviderRadioGroup
        name={searchName}
        label={t('webAccessSearchGroup')}
        autoLabel={t('webAccessAuto')}
        unmountedLabel={t('webAccessNotMounted')}
        disabled={!state.writable}
        group={resolvedGroup(state.search, t)}
        onPick={(id) => { props.onPick('search', id) }}
      />
      <ProviderRadioGroup
        name={fetchName}
        label={t('webAccessFetchGroup')}
        autoLabel={t('webAccessAuto')}
        unmountedLabel={t('webAccessNotMounted')}
        disabled={!state.writable}
        group={resolvedGroup(state.fetch, t)}
        onPick={(id) => { props.onPick('fetch', id) }}
      />
      {state.keyMissing ? <p className={css.warning} role="status">{t('webAccessKeyMissing')}</p> : null}
      {state.ambiguousAuto ? <p className={css.warning} role="status">{t('webAccessAmbiguous')}</p> : null}
    </PluginCard>
  )
}
