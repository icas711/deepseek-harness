/**
 * Telegram Bot API transport: one `call` per API method over ordinary fetch.
 * The factory seam below is the only place the network enters, so tests
 * substitute it wholesale.
 * @module @deepseek-ai/dsh-telegram-notifier/transport
 */

/** Failure of one Bot API call, carrying the method and the API's account. */
export class TelegramApiError extends Error {
  /**
   * Construct one call failure.
   * @param method - the Bot API method that failed.
   * @param description - the API's description or the network account.
   */
  constructor(method: string, description: string) {
    super(`telegram: ${method} failed: ${description}`)
    this.name = 'TelegramApiError'
  }
}

/** The transport face the service programs against. */
export interface TelegramTransport {
  /**
   * Invoke one Bot API method.
   * @param method - Bot API method name, for example `getUpdates`.
   * @param payload - JSON-serializable method arguments.
   * @returns the API's `result` value.
   * @throws {@link TelegramApiError} when the API answers `ok: false` or the
   * round-trip fails.
   */
  call(method: string, payload: Record<string, unknown>): Promise<unknown>
}

/**
 * Round-trip one Bot API method over ordinary fetch. The Bot API answers
 * every failure with a JSON body (`ok: false`, `description`), whatever the
 * HTTP status, so the body — not the status — carries the account.
 * @param botToken - the bot token from BotFather.
 * @returns the transport.
 */
export function createFetchTransport(botToken: string): TelegramTransport {
  return {
    async call(method, payload) {
      let response: Response
      try {
        response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } catch (error) {
        throw new TelegramApiError(method, `network failure: ${error instanceof Error ? error.message : String(error)}`)
      }
      const text = await response.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new TelegramApiError(method, `non-JSON response (HTTP ${String(response.status)}): ${text.slice(0, 200)}`)
      }
      if (typeof parsed !== 'object' || parsed === null || (parsed as { ok?: unknown }).ok !== true) {
        const description = (parsed as { description?: unknown } | null)?.description
        throw new TelegramApiError(
          method,
          typeof description === 'string' ? description : `HTTP ${String(response.status)}`,
        )
      }
      return (parsed as { result?: unknown }).result
    },
  }
}

/**
 * Test seam: the transport factory the service consults at construction.
 * Tests substitute `create`; production never touches this.
 */
export const transportFactory: { create: (botToken: string) => TelegramTransport } = {
  create: createFetchTransport,
}
