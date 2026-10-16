/**
 * Provisioning one stored Z.AI route: fetch what the endpoint serves and
 * write the route's stored profile from it — the write half of "pick a
 * provider, save a key", offered for the Z.AI routes this adapter knows.
 *
 * Z.AI's listing discloses ids only, so the written facts come from the
 * installed catalog first, the published GLM-5.3 documentation second (the
 * family's capacities and its always-on low/high/max reasoning dialect), and
 * the route's defaults last. The stored entry for a surviving id wins over
 * all of that: a re-pull refreshes WHICH models a route serves, never a
 * correction the user typed into one.
 *
 * @module dsh-llm-pi-ai/provision
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmProvisionResult } from '@deepseek-ai/dsh-llm'
import { catalogProvider, isZaiRoute, ZAI_CATALOG_ROUTES } from './catalog.ts'
import type { Config, PiAiCompatProfile, PiAiModelProfile, PiAiProviderProfile, PiAiReasoningEfforts } from './config.ts'
import { fetchListing } from './discovery.ts'

/**
 * The credential reference each Z.AI catalog route's key is stored under —
 * the same convention the Models page derives and the catalog provider's own
 * environment variable names. Provisioning needs it before a profile exists:
 * the onboarding card saves a key alone, and the profile it leaves for this
 * module to build is the one that names the reference.
 */
const ZAI_CATALOG_CREDENTIAL_REFS: Readonly<Record<string, string>> = {
  zai: 'ZAI_API_KEY',
  'zai-coding-cn': 'ZAI_CODING_CN_API_KEY',
}

/**
 * GLM-5.3 family capacities, published at docs.z.ai/guides/llm/glm-5.3:
 * a 1M-token context window and a 128K maximum output. The listing endpoint
 * discloses neither, so these are the route-default facts the family gets.
 */
const GLM_53_CONTEXT_WINDOW = 1_048_576
const GLM_53_MAX_TOKENS = 131_072

/**
 * The GLM-5.3 reasoning dialect: thinking cannot be disabled (a disabled
 * request fails), the endpoint accepts `reasoning_effort`, and the offered
 * levels are exactly low, high, and max. The zai thinking format is what the
 * installed catalog already uses for this family's endpoints.
 */
const GLM_53_REASONING_EFFORTS: PiAiReasoningEfforts = { low: 'low', high: 'high', max: 'max' }
const GLM_53_COMPAT: PiAiCompatProfile = { thinkingFormat: 'zai', supportsReasoningEffort: true }

/** Whether the GLM-5.3 documentation's facts apply to this model id. */
function isGlm53Family(id: string): boolean {
  return /^glm-5\.3/i.test(id)
}

/**
 * One stored entry that carries any field beyond the id is a correction the
 * user (or an earlier provision) wrote deliberately; it survives verbatim.
 */
function isBareEntry(entry: PiAiModelProfile): boolean {
  const { id: _id, ...rest } = entry
  return Object.keys(rest).length === 0
}

/**
 * The profile entry one endpoint model gets: the family's documented facts,
 * or a bare id that inherits the installed catalog entry, then the route's
 * defaults. A disclosed capacity wins over the documented one — the endpoint
 * is the fresher source about itself.
 */
function entryFor(id: string, discovered: LlmDiscoveredModel, stored: PiAiModelProfile | undefined): PiAiModelProfile {
  if (stored !== undefined && !isBareEntry(stored)) return stored
  if (!isGlm53Family(id)) return { id }
  return {
    id,
    contextWindow: discovered.contextWindow ?? GLM_53_CONTEXT_WINDOW,
    maxTokens: discovered.maxTokens ?? GLM_53_MAX_TOKENS,
    // The family's published input modalities: text-only for the flagship,
    // images for the flash variant (docs.z.ai model pages).
    input: /flash/i.test(id) ? ['text', 'image'] : ['text'],
    reasoningEfforts: { ...GLM_53_REASONING_EFFORTS },
    compat: { ...GLM_53_COMPAT },
  }
}

/** Collaborators provisioning needs from the plugin that owns the section. */
export interface ProvisionDeps {
  /** The stored raw section — where the route's current profile lives. */
  storedSection(): Config
  /**
   * Resolves one stored credential reference, failing loud when a named
   * reference is unset — the same resolution a request would take.
   */
  resolveCredentialRef(provider: string, ref: string): Promise<string>
  /** Persists one route's profile through the settings seam, validated at write. */
  writeRouteProfile(provider: string, profile: PiAiProviderProfile): Promise<void>
}

/**
 * Provision one stored Z.AI route: interrogate its endpoint, build the full
 * profile (endpoint, live listing, documented capacities and reasoning), and
 * write it back. A Z.AI catalog route is provisioned from nothing — the
 * onboarding card saves a key alone and the built profile is the route's
 * first. The stored profile is untouched on every failure.
 * @param provider - the route to provision.
 * @param signal - the caller's cancellation signal, when any.
 * @param deps - the plugin-owned collaborators.
 * @returns how many models the route's profile now serves.
 * @throws LlmError when the route is not a Z.AI route, has no endpoint or
 *   usable credential, or the endpoint refuses.
 */
export async function provisionZaiRoute(
  provider: string,
  signal: AbortSignal | undefined,
  deps: ProvisionDeps,
): Promise<LlmProvisionResult> {
  const stored = deps.storedSection().providers?.[provider]
  const catalogZai = ZAI_CATALOG_ROUTES.has(provider)
  if (stored === undefined && !catalogZai) {
    throw new LlmError(
      `llm-pi-ai: route "${provider}" has no stored profile and no Z.AI template to build one from`,
      'INVALID_PROVISION',
    )
  }
  if (!isZaiRoute(provider, stored)) {
    throw new LlmError(
      `llm-pi-ai: route "${provider}" is not a Z.AI route; provisioning is offered for zai routes only`,
      'NOT_PROVISIONABLE',
    )
  }
  const baseURL = stored?.baseURL ?? catalogProvider(provider)?.baseUrl
  /* v8 ignore next 5 -- both fallbacks cannot miss together: a catalog route always has a
   * catalog endpoint, and a route identified by its host was identified through that endpoint. */
  if (baseURL === undefined) {
    throw new LlmError(
      `llm-pi-ai: route "${provider}" has no endpoint; set a baseURL before provisioning`,
      'PROVISION_FAILED',
    )
  }
  // The credential the fetch uses is the one the built profile will name: a
  // stored profile's own reference — absent meaning provider-native discovery,
  // so the fetch goes out unauthenticated the same way a request would — or,
  // when the profile is built from nothing, the catalog route's conventional
  // reference, which the onboarding key save has just stored. Reaching here
  // from nothing means the route is a catalog one: the non-catalog miss threw
  // above.
  const apiKeyEnv = stored !== undefined
    ? stored.apiKeyEnv
    : ZAI_CATALOG_CREDENTIAL_REFS[provider]
  const apiKey = apiKeyEnv === undefined ? undefined : await deps.resolveCredentialRef(provider, apiKeyEnv)
  const listed = await fetchListing(baseURL, apiKey, signal)

  // The endpoint owns WHICH ids the route serves; a stored entry with facts
  // of its own keeps them, everything else is built fresh.
  const storedModels = new Map((stored?.models ?? []).map(model => [model.id, model]))
  const models = listed.map(entry => entryFor(entry.id, entry, storedModels.get(entry.id)))
  const servesGlm53 = models.some(model => isGlm53Family(model.id))
  const profile: PiAiProviderProfile = {
    ...(stored ?? {}),
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    baseURL,
    liveModels: true,
    defaultContextWindow: GLM_53_CONTEXT_WINDOW,
    defaultMaxTokens: GLM_53_MAX_TOKENS,
    // A route serving the family needs a level that always dispatches: the
    // family has no off, so an unspecified effort would send a disabled
    // request that fails. The documented default is max.
    ...(servesGlm53 ? { reasoning: stored?.reasoning ?? 'max' } : {}),
    models,
  }
  await deps.writeRouteProfile(provider, profile)
  return { models: models.length }
}
