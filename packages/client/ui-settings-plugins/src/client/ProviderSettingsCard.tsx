/**
 * One provider's card, presentation-driven: the same chrome for every web
 * provider — its copy keys, its section fields, and, when the provider
 * resolves a key, the write-only credential control. The picker's current
 * pick opens and highlights its card, so the card takes its focused state
 * from the shared focus store rather than from disclosure alone.
 */

import { useId } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { ProviderCardFace } from './provider-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for a provider card. */
export type ProviderSettingsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ProviderCardFace>

/**
 * Render one provider's card from its static presentation.
 * @param props - locale copy, the card snapshot, its form actions, and the presentation.
 * @returns the card.
 */
export function ProviderSettingsCard(props: ProviderSettingsCardProps) {
  const { t } = props
  const state = props.useProviderCard(snapshot => snapshot)
  const focused = props.useWebProviderFocus(snapshot => snapshot)[props.focus.group] === props.focus.providerId
  const disabled = !state.writable
  const id = useId()
  const { presentation } = props
  return (
    <PluginCard
      t={t}
      titleKey={presentation.titleKey}
      descriptionKey={presentation.descriptionKey}
      state={state}
      focused={focused}
      onSave={props.save}
      onDiscard={props.discard}
    >
      {presentation.credential
        ? (
          <SecretField
            id={`${id}-key`}
            label={t(presentation.credential.labelKey)}
            hint={t(presentation.credential.hintKey)}
            // The credentials domain accepts a key even when the settings
            // document itself is read-only; they are separate stores with
            // separate refusals. Its own writability is what disables this
            // control — a key sourced from the process environment cannot be
            // written from here.
            disabled={!state.apiKeyWritable}
            text={state.apiKey.text}
            configured={state.apiKeyConfigured}
            stateLabel={state.apiKeyConfigured ? t(presentation.credential.configuredKey) : t(presentation.credential.missingKey)}
            onEdit={(text) => { props.edit('apiKey', text) }}
          />
        )
        : null}
      {presentation.fields.map((field) => {
        const fieldState = state.fields[field.field]
        if (fieldState === undefined) return null
        return (
          <ValueField
            key={field.field}
            id={`${id}-${field.field}`}
            label={t(field.labelKey)}
            hint={t(field.hintKey)}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('invalidNumber')}
            numeric={field.numeric === true}
            disabled={disabled}
            {...fieldState}
            onEdit={(text) => { props.edit(field.field, text) }}
            onReset={() => { props.resetField(field.field) }}
          />
        )
      })}
    </PluginCard>
  )
}
