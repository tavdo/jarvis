/**
 * The contract between JARVIS and whatever model is answering.
 *
 * The rest of the bridge speaks only this: a provider-neutral conversation and
 * a stream of events back. Nothing outside bridge/ai/ knows which vendor is on
 * the other end, so swapping one for another is a new subclass and a line in
 * ai/index.mjs.
 *
 * Conversation messages:
 *
 * @typedef {{ role: 'user', content: string }} UserMessage
 * @typedef {{ id: string, name: string, arguments: string, extra?: object }} ToolCall
 *   `extra` is provider-private data that must go back with the call on the
 *   next request exactly as received (Gemini's thought signatures).
 * @typedef {{ role: 'assistant', content: string, toolCalls?: ToolCall[] }} AssistantMessage
 * @typedef {{ type: 'text', text: string } | { type: 'image', data: string, mimeType: string }} ContentBlock
 * @typedef {{ role: 'tool', toolCallId: string, name: string, content: ContentBlock[], isError?: boolean }} ToolMessage
 * @typedef {UserMessage | AssistantMessage | ToolMessage} Message
 *
 * Tool definitions, as the registry produces them:
 *
 * @typedef {{ name: string, description: string, parameters: object }} ToolDefinition
 *
 * Events a step yields, in order:
 *
 * @typedef {{ type: 'text', delta: string }} TextEvent
 *   A piece of the spoken answer.
 * @typedef {{ type: 'hosted_tool', name: string }} HostedToolEvent
 *   The provider is running one of its own tools (web search), which needs no
 *   action from us beyond telling the HUD.
 * @typedef {{ type: 'end', text: string, toolCalls: ToolCall[], stop: 'completed' | 'max_output_tokens' | string }} EndEvent
 *   Always last. Tool calls to execute, if any.
 */

export class AIProvider {
  /** @returns {string} e.g. 'openai' */
  get name() {
    throw new Error('not implemented')
  }

  /** @returns {string} the model in use, for logs and the HUD */
  get model() {
    throw new Error('not implemented')
  }

  /** @returns {boolean} whether the provider brings its own web search tool */
  get webSearch() {
    return false
  }

  /**
   * One model call: the conversation so far in, a stream of events out.
   * Multi-step tool use is the caller's loop, not the provider's.
   *
   * @param {{ system: string, messages: Message[], tools: ToolDefinition[], signal?: AbortSignal }} request
   * @returns {AsyncGenerator<TextEvent | HostedToolEvent | EndEvent>}
   */
  // eslint-disable-next-line require-yield
  async *step(_request) {
    throw new Error('not implemented')
  }

  /**
   * A cheap check that the credentials and model work, run once at boot so a
   * bad key is reported before anyone says "Hey Jarvis".
   * @returns {Promise<{ ok: boolean, error?: AIError }>}
   */
  async check() {
    return { ok: true }
  }
}

/**
 * A failure worth telling the user about, with a message that is safe to show
 * — and, since anything on screen may be read aloud, safe to speak. It never
 * carries a credential.
 *
 * Codes: missing_key, invalid_key, permission, model_unavailable, quota,
 * rate_limit, bad_request, timeout, network, server, aborted, unknown.
 */
export class AIError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ status?: number, cause?: unknown }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'AIError'
    this.code = code
    this.status = extra.status
    if (extra.cause) this.cause = extra.cause
  }
}
