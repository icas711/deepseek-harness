/**
 * SSE (Server-Sent Events) parsing for Z.ai streaming responses.
 *
 * Decodes an SSE byte stream into event `data` payloads using eventsource-parser.
 * The literal `[DONE]` is yielded as the final payload so the caller owns flushing.
 *
 * @module dsh-llm-zai/sse
 */

import { EventSourceParserStream } from 'eventsource-parser/stream'
import { LlmError } from '@deepseek-ai/dsh-llm'

/** The terminal payload Z.ai (OpenAI-compatible) send after the last chunk. */
export const DONE = '[DONE]'

/**
 * Parse an SSE byte stream into data payloads.
 *
 * Yields each event's data payload in arrival order, with `[DONE]` as the final value.
 * Throws `LlmError('STREAM_CLOSED')` when the stream ends without the sentinel.
 *
 * @param stream - Raw SSE bytes from fetch response body
 * @param onComment - Optional transport-activity callback for comments
 * @yields string data payloads, ending with `[DONE]`
 */
export async function* parseSse(
  stream: ReadableStream<BufferSource>,
  onComment?: (comment: string) => void,
): AsyncGenerator<string> {
  const events = stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream({ onComment }))

  for await (const { data } of events) {
    yield data
    if (data === DONE) return
  }

  throw new LlmError('SSE stream ended without [DONE]', 'STREAM_CLOSED')
}
