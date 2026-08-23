/**
 * Cordis plugin entry point for `@deepseek-ai/dsh-llm-zai`.
 *
 * Registers the Z.ai LLM adapter and configuration schema.
 *
 * @module dsh-llm-zai
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError, resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  ZaiAdapter,
} from './adapter.js'
import type { ModelEntry, ZaiAdapterOptions } from './adapter.js'

export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  ZaiAdapter,
} from './adapter.js'
export type { ModelEntry, ZaiAdapterOptions } from './adapter.js'
export type { RequestDefaults } from './serialize.js'
export type * from './types.js'

export const name = 'llm-zai'
export const inject = ['llm']

const NS = settingsNamespace('llm-zai')
const DEFAULT_API_KEY_ENV = 'ZAI_API_KEY'
/**
 * The single provider route this plugin owns. `zai-official` mirrors
 * `deepseek-official`: pi-ai's installed catalog owns the bare `zai` route
 * for its own adapter family, and the configurable-provider directory
 * refuses a duplicate declaration.
 */
const PROVIDER = 'zai-official'

/** Default model catalog for Z.ai. */
const DEFAULT_MODELS: ModelEntry[] = [
  { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1_000_000, description: 'Latest GLM with 1M context and thinking/reasoning support. Add "[1m]" suffix for full reasoning mode.' },
  { id: 'glm-5.3[1m]', name: 'GLM-5.3 (1M reasoning)', contextWindow: 1_000_000, description: 'GLM-5.3 with full reasoning mode enabled (1M context).' },
  { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 1_000_000, description: 'High-performance model with 1M context and thinking support.' },
  { id: 'glm-5.1', name: 'GLM-5.1', contextWindow: 200_000, description: 'Advanced reasoning model with 200K context.' },
  { id: 'glm-5', name: 'GLM-5', contextWindow: 200_000, description: 'Standard GLM-5 model with 200K context.' },
  { id: 'glm-5-turbo', name: 'GLM-5-Turbo', contextWindow: 200_000, description: 'Faster variant of GLM-5 with 200K context.' },
  { id: 'glm-4.7', name: 'GLM-4.7', contextWindow: 200_000, description: 'GLM-4.7 with 200K context and thinking support.' },
  { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash', contextWindow: 200_000, description: 'Fast variant of GLM-4.7 with 200K context.' },
  { id: 'glm-4.7-flashx', name: 'GLM-4.7-FlashX', contextWindow: 200_000, description: 'Ultra-fast variant of GLM-4.7 with 200K context.' },
  { id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 205_000, description: 'GLM-4.6 with 205K context and thinking support.' },
  { id: 'glm-4.6v', name: 'GLM-4.6v', contextWindow: 128_000, description: 'Multimodal variant of GLM-4.6 (vision + text) with 128K context.' },
  { id: 'glm-4.5', name: 'GLM-4.5', contextWindow: 131_000, description: 'GLM-4.5 with 131K context and thinking support.' },
  { id: 'glm-4.5-air', name: 'GLM-4.5-Air', contextWindow: 131_000, description: 'Lightweight variant of GLM-4.5 with 131K context.' },
  { id: 'glm-4.5v', name: 'GLM-4.5v', contextWindow: 64_000, description: 'Multimodal variant of GLM-4.5 (vision + text) with 64K context.' },
]

/**
 * Plugin config, validated by the same-named schemastery schema.
 */
export interface Config {
  /** Credential reference (environment-variable name) resolved per request. */
  apiKeyEnv?: string
  /** Endpoint base; falls back to $ZAI_BASE_URL from a trusted environment layer. */
  baseURL?: string
  /** Deployment thinking policy; `disabled` limits every conversation request to `off`. */
  thinking?: 'enabled' | 'disabled'
  /** Default thinking effort; `off` disables thinking per request. */
  reasoningEffort?: 'off' | 'high' | 'max'
  /** Default per-request output cap (default 256,000). */
  maxTokens?: number
  /** Positive context capacity used when the selected model has no exact value (default 1,000,000). */
  defaultContextWindow?: number
  /** Advisory models shown by discovery consumers. */
  models?: ModelEntry[]
  /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs?: number
  /** Provider-owned model-request retry policy. */
  retryPolicy?: RetryPolicyConfig
}

const catalogModel: z<ModelEntry> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
})

export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  thinking: z.union(['enabled', 'disabled']),
  reasoningEffort: z.union(['off', 'high', 'max']),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  models: z.array(catalogModel).default(DEFAULT_MODELS),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema,
})

/** Public API default. */
export const PUBLIC_BASE_URL = 'https://api.z.ai/api/paas/v4'

/** Environment variable naming this provider's endpoint. */
const BASE_URL_ENV = 'ZAI_BASE_URL'

/** One resolution's complete request facts. */
export type ResolvedZaiOptions = ZaiAdapterOptions

/** Resolve, validate, and detach the advisory model catalog. */
function resolveModels(models: readonly ModelEntry[] | undefined): ModelEntry[] {
  const seen = new Set<string>()
  return (models ?? DEFAULT_MODELS).map((model) => {
    if (model.id.length === 0) throw new Error('llm-zai: catalog model ids must be non-empty')
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-zai: catalog model "${model.id}" has an empty name`)
    }
    if (model.contextWindow !== undefined
      && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `llm-zai: catalog model "${model.id}" contextWindow must be a positive integer`,
      )
    }
    if (model.maxTokens !== undefined
      && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `llm-zai: catalog model "${model.id}" maxTokens must be a positive integer`,
      )
    }
    if (seen.has(model.id)) throw new Error(`llm-zai: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    }
  })
}

/**
 * Resolve adapter options from raw config to validated connection facts.
 */
export function resolveAdapterOptions(config: Config, environment?: LaunchEnvironmentSnapshot): ResolvedZaiOptions {
  if (config.thinking === 'disabled'
    && config.reasoningEffort !== undefined
    && config.reasoningEffort !== 'off') {
    throw new Error('llm-zai: only reasoningEffort "off" can be configured when thinking is disabled')
  }
  if (config.defaultContextWindow !== undefined
    && (!Number.isInteger(config.defaultContextWindow) || config.defaultContextWindow <= 0)) {
    throw new Error('llm-zai: defaultContextWindow must be a positive integer')
  }
  if (config.maxTokens !== undefined
    && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0)) {
    throw new Error('llm-zai: maxTokens must be a positive safe integer')
  }
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-zai: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }

  return {
    apiKeyEnv: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    baseURL: config.baseURL
      ?? environment?.get(BASE_URL_ENV)?.value
      ?? PUBLIC_BASE_URL,
    defaults: {
      thinking: config.thinking,
      reasoningEffort: config.reasoningEffort,
    },
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    defaultContextWindow: config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    models: resolveModels(config.models),
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-zai: retryPolicy'),
    thinkingEnabled: config.thinking !== 'disabled',
  }
}

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastGood: ResolvedZaiOptions | undefined
  const options = (): ResolvedZaiOptions => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx))
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-zai: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }
  options()

  const resolveApiKey = async (connection: ResolvedZaiOptions): Promise<string> => {
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-zai', ref)
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-zai', ref)
      }
    }
    throw new LlmError(
      `llm-zai: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  let userId: AnonymousUserId | undefined
  const resolveUserId = (): AnonymousUserId => userId ??= getOrCreateAnonymousUserId()
  const adapter = new ZaiAdapter({ options, resolveApiKey, resolveUserId })
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'Z.ai', settingsNs: NS, settingsPath: [] },
  ])
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  let registeredPolicy = options().retryPolicy
  const ensureRegistrationFacts = (): void => {
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    registration.replace([PROVIDER])
    registeredPolicy = policy
  }

  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: ensureRegistrationFacts,
  })
}
