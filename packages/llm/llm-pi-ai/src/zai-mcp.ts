/**
 * The official Zhipu MCP server entry a route's `mcp` profile switch carries.
 *
 * Z.AI's `chat/completions` accepts MCP server entries in its `tools` array:
 * the endpoint connects to the server itself and executes the model's MCP
 * tool calls inside the request, so the capability is request-side only — no
 * harness tool, no client-side round trip. The entry names the official
 * coding-plan server, which needs no `server_url`, and omits
 * `allowed_tools`, which the API reads as "every tool the server offers".
 *
 * The entry is an external wire specification, so its shape is fixed here;
 * which routes carry it is the profile's `mcp` configuration field.
 *
 * @module dsh-llm-pi-ai/zai-mcp
 */

/**
 * The MCP server tool entry appended to every Z.AI `chat/completions`
 * request, after the request's function tools.
 */
export const ZAI_MCP_SERVER_TOOL = {
  type: 'mcp',
  mcp: {
    server_label: 'mcp code',
    transport_type: 'streamable-http',
  },
} as const

/**
 * The pi-ai `onPayload` hook for Z.AI routes: answer with the request params
 * carrying {@link ZAI_MCP_SERVER_TOOL} appended to `tools`, creating the
 * array when the request declares no function tools.
 * @param payload - the provider request params pi-ai assembled; `unknown` at the SDK option boundary, so its shape is narrowed here.
 * @returns the replacement params object, never the same reference as the input.
 * @throws Error when the payload is not an object with an array-or-absent
 *   `tools` field — a pi-ai payload contract drift, which must not silently
 *   drop the MCP capability.
 */
export function withZaiMcpServer(payload: unknown): Record<string, unknown> & { tools: unknown[] } {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('llm-pi-ai: the Z.AI MCP server hook received a non-object request payload from pi-ai')
  }
  const params = payload as Record<string, unknown>
  const tools = params.tools
  if (tools !== undefined && !Array.isArray(tools)) {
    throw new Error('llm-pi-ai: the Z.AI MCP server hook received a request payload whose tools field is not an array')
  }
  return { ...params, tools: [...tools === undefined ? [] : tools as unknown[], ZAI_MCP_SERVER_TOOL] }
}
