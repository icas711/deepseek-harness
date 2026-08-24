import { describe, expect, it } from 'vitest'
import {
  ZaiSearchProvider,
  ZAI_DEFAULT_BASE_URL,
  ZAI_DEFAULT_COUNT,
  ZAI_DEFAULT_SEARCH_ENGINE,
} from '@deepseek-ai/dsh-web-search-zai'

/**
 * Real-API smoke for the Z.ai search provider. Self-skips without
 * `$ZAI_API_KEY`, per the with-key e2e policy in docs/testing.md.
 */
const apiKey = process.env.ZAI_API_KEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('ZaiSearchProvider real API', () => {
  it('returns structured sources for a live query', async () => {
    const provider = new ZaiSearchProvider({
      apiKey: apiKey!,
      apiKeyEnv: 'ZAI_API_KEY',
      baseURL: process.env.ZAI_SEARCH_BASE_URL ?? ZAI_DEFAULT_BASE_URL,
      searchEngine: process.env.ZAI_SEARCH_ENGINE ?? ZAI_DEFAULT_SEARCH_ENGINE,
      count: ZAI_DEFAULT_COUNT,
    })
    const result = await provider.search({ query: 'What is DeepSeek Harness?', maxResults: 5 })
    expect(result.content).toBeUndefined()
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)
})
