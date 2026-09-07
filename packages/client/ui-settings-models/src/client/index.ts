/**
 * Models settings and product-onboarding plugin, browser half. It registers
 * the Models page plus the ordered internal-testing and official-DeepSeek
 * onboarding dialogs, whose UI shares this package's modal wrapper. The Host
 * settings and credential contracts stay behind their existing wire APIs.
 * Export discipline:
 * packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (settings/credentials invalidations ride the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ModelsSection } from './ModelsSection.tsx'
import type { ModelsSectionInjected } from './ModelsSection.tsx'
import { RetrySettingsRow } from './RetrySettingsRow.tsx'
import type { RetryPolicyValues, RetrySettingsRowInjected } from './RetrySettingsRow.tsx'
import { DeepSeekOnboardingDialog } from './DeepSeekOnboardingDialog.tsx'
import type { DeepSeekOnboardingInjected } from './DeepSeekOnboardingDialog.tsx'
import { WelcomeNotice } from './WelcomeNotice.tsx'
import type { WelcomeNoticeInjected } from './WelcomeNotice.tsx'
import { refreshWelcomeIfLoaded, WelcomeNoticeStore } from './welcome-store.ts'
import { ModelsSettingsStore } from './store.ts'
import { ru, type ModelsKey } from './locales.ts'
import { WELCOME_NOTICE_SETTINGS_NAMESPACE } from '../onboarding-copy.ts'

export type { ModelsSectionInjected, ModelsSectionProps } from './ModelsSection.tsx'
export type { ModelsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Models page + product-onboarding copy. */
    'settings.models': ModelsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.models'
export type { ModelsSettingsState, ProviderRow } from './store.ts'

/**
 * Refetch the page snapshot only after its first load: an unopened Models
 * page must not fetch on background invalidations.
 * @param controller - the page store.
 */
export function refreshIfLoaded(controller: ModelsSettingsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 * `settingsScope` backs the retry row's auto-refreshing namespace mirror;
 * `remote` carries its pushed settings invalidation.
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/** The settings namespace the DeepSeek adapter owns (its section stores `retryPolicy`). */
const DEEPSEEK_SECTION_NS = 'llm-deepseek'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Register the Models section once the `settings.section` declaration is on
 * the ledger, wire its store to the connection, and keep it fresh on every
 * pushed invalidation (settings, credentials, or provider topology).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, ru), 'ui-settings-models: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new ModelsSettingsStore(connection.api)
  const useSnapshot = bindSnapshotSelector(controller.store)
  // Registration-time text (the nav label thunk) and the inject faces share
  // one bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS) as ModelsSectionInjected['t']
  const injected = (): ModelsSectionInjected => ({
    controller,
    useSnapshot,
    api: connection.api,
    t,
  })
  const deepSeekOnboardingInjected = (): DeepSeekOnboardingInjected => ({
    controller,
    hooks: { models: controller.store },
    api: connection.api,
    t,
  })
  const welcomeController = new WelcomeNoticeStore(
    connection.api,
    connection.isLoopback ? 'host' : 'memory',
  )
  const welcomeInjected = (): WelcomeNoticeInjected => ({
    controller: welcomeController,
    hooks: { welcome: welcomeController.store },
    t,
  })

  // Pushed invalidations converge every open surface without polling: any
  // settings/credentials/topology change refetches once the page loaded.
  ctx.effect(() => {
    const refreshModels = (): void => { refreshIfLoaded(controller) }
    const refreshAll = (): void => {
      refreshModels()
      refreshWelcomeIfLoaded(welcomeController)
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        refreshModels()
        if (ns === WELCOME_NOTICE_SETTINGS_NAMESPACE) refreshWelcomeIfLoaded(welcomeController)
      }),
      ctx.remote.$on('credentials/updated', refreshModels),
      ctx.remote.$on('llm/adapters-updated', refreshModels),
      ctx.on('connection/reset', refreshAll),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-settings-models: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'models',
    order: 10,
    label: () => t('nav'),
    inject: injected,
  }, ModelsSection))

  // The General-section retry row: one auto-refreshing mirror of the shared
  // `llm-deepseek` section plus two explicit writes. The write carries the
  // revision the mirror last accepted, so a concurrent edit answers
  // settings-conflict instead of silently landing on top of it.
  const retryScope = ctx.settingsScope.bind<unknown>({ namespace: DEEPSEEK_SECTION_NS })
  const mutateRetry = async (op: { op: 'set'; value: unknown } | { op: 'unset' }): Promise<string | undefined> => {
    const snapshot = retryScope.getSnapshot()
    const pathOp = op.op === 'set'
      ? { op: 'set' as const, path: ['retryPolicy'], value: op.value }
      : { op: 'unset' as const, path: ['retryPolicy'] }
    const response = await connection.api.settings.mutate({
      ns: DEEPSEEK_SECTION_NS,
      ops: [pathOp],
      ...(snapshot.revision === undefined ? {} : { expectedRevision: snapshot.revision }),
    })
    if (!response.result.ok) {
      return response.result.error.code === 'settings-conflict' ? t('retriesConflict') : response.result.error.message
    }
    return undefined
  }
  const saveRetryPolicy = async (values: RetryPolicyValues): Promise<string | undefined> => {
    const snapshot = retryScope.getSnapshot()
    const existing = isRecord(snapshot.user) && isRecord(snapshot.user.retryPolicy)
      ? snapshot.user.retryPolicy
      : {}
    const existingBackoff = isRecord(existing.backoff) ? existing.backoff : {}
    // The user-layer subtree replaces wholesale, so the row carries its own
    // previous fields forward; the composition entry merges underneath at
    // resolve time and stays authoritative for everything the row never writes.
    return mutateRetry({
      op: 'set',
      value: {
        ...existing,
        mode: 'normal',
        maxRetries: values.maxRetries,
        backoff: {
          ...existingBackoff,
          initialDelayMs: values.initialDelayMs,
          maxDelayMs: values.maxDelayMs,
        },
      },
    })
  }
  const resetRetryPolicy = async (): Promise<string | undefined> => {
    return mutateRetry({ op: 'unset' })
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'llm-retries',
    order: 30,
    locale: NS,
    inject: (): RetrySettingsRowInjected => ({
      hooks: { provider: retryScope },
      saveRetryPolicy,
      resetRetryPolicy,
    }),
  }, RetrySettingsRow))

  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'welcome-notice',
    order: -100,
    inject: welcomeInjected,
  }, WelcomeNotice))
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'deepseek-official',
    order: 0,
    inject: deepSeekOnboardingInjected,
  }, DeepSeekOnboardingDialog))
}
