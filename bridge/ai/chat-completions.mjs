import OpenAI from 'openai'
import { AIError, AIProvider } from './provider.mjs'
import { describeApiError } from './openai.mjs'

/**
 * Any service that speaks OpenAI's Chat Completions format, through the
 * official OpenAI SDK pointed at a different base URL. Gemini (both Google AI
 * Studio and Vertex AI) is reached this way; neither offers the Responses API.
 *
 * Two things differ from the Responses provider:
 *   - Tool results can only be text here, so any picture a tool returns (the
 *     camera, a screenshot) follows the tool messages as a user message with
 *     the image attached.
 *   - Gemini attaches a thought signature to each tool call, and rejects the
 *     next request if it does not come back. It is kept on the call as `extra`
 *     and returned verbatim.
 *
 * Stateless like the Responses provider: the whole relevant conversation is
 * sent on every call and nothing is kept for later on the service's side.
 */
export class ChatCompletionsProvider extends AIProvider {
  /**
   * @param {{
   *   name: string,
   *   model: string,
   *   baseURL: string,
   *   apiKey?: string | (() => Promise<string>),
   *   reasoningEffort?: string,
   *   maxOutputTokens: number,
   *   missingKey: string,
   *   vendor: Parameters<typeof describeApiError>[1],
   *   describeError?: (err: unknown) => AIError | null,
   *   fetch?: typeof fetch,
   *   lightCheck?: boolean,
   * }} options
   */
  constructor(options) {
    super()
    this.options = options
    this.client = options.apiKey
      ? new OpenAI({
          apiKey: options.apiKey,
          baseURL: options.baseURL,
          fetch: options.fetch,
          maxRetries: 2,
          timeout: 90_000,
        })
      : null
  }

  get name() {
    return this.options.name
  }

  get model() {
    return this.options.model
  }

  requireClient() {
    if (!this.client) throw new AIError('missing_key', this.options.missingKey)
    return this.client
  }

  /**
   * A one-word request: proves the credentials, the model and the billing in
   * one go. With `lightCheck`, only the model is looked up — that proves the
   * key and the model without spending a request from a small daily quota.
   */
  async check() {
    try {
      if (this.options.lightCheck) {
        await this.requireClient().models.retrieve(this.options.model)
        return { ok: true }
      }
      const stream = this.step({
        system: 'Reply with one word.',
        messages: [{ role: 'user', content: 'Ready?' }],
        tools: [],
      })
      for await (const _event of stream) {
        /* drain */
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: this.toAIError(err) }
    }
  }

  async *step({ system, messages, tools, signal }) {
    const client = this.requireClient()
    const { model, reasoningEffort, maxOutputTokens } = this.options

    const params = {
      model,
      messages: toMessages(system, messages),
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            tool_choice: 'auto',
          }
        : {}),
      stream: true,
      max_tokens: maxOutputTokens,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    }

    let stream
    try {
      stream = await client.chat.completions.create(params, { signal })
    } catch (err) {
      throw this.toAIError(err)
    }

    let text = ''
    let finish = null
    /** @type {{ index?: number, id: string, name: string, arguments: string, extra?: object }[]} */
    const calls = []

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0]
        if (!choice) continue
        const delta = choice.delta ?? {}
        if (delta.content) {
          text += delta.content
          yield { type: 'text', delta: delta.content }
        }
        for (const part of delta.tool_calls ?? []) {
          // OpenAI streams a call as fragments sharing an index. Gemini sends
          // each call whole, sometimes without an index, so its id is the key.
          let call =
            (part.index != null && calls.find((c) => c.index === part.index)) ||
            (part.id && calls.find((c) => c.id === part.id)) ||
            (part.index == null && !part.id && calls.at(-1)) ||
            null
          if (!call) {
            call = { index: part.index ?? undefined, id: '', name: '', arguments: '' }
            calls.push(call)
          }
          if (part.id) call.id = part.id
          if (part.function?.name) call.name = part.function.name
          if (part.function?.arguments) call.arguments += part.function.arguments
          if (part.extra_content) call.extra = { ...call.extra, ...part.extra_content }
        }
        if (choice.finish_reason) finish = choice.finish_reason
      }
    } catch (err) {
      throw this.toAIError(err)
    }

    const toolCalls = calls.map((c, i) => ({
      id: c.id || `call_${Date.now().toString(36)}_${i}`,
      name: c.name,
      arguments: c.arguments,
      ...(c.extra ? { extra: c.extra } : {}),
    }))
    // A stream that ends with no finish reason was cut off on the way.
    const stop =
      finish === 'length' ? 'max_output_tokens' : finish === null ? 'incomplete' : finish === 'content_filter' ? 'content_filter' : 'completed'
    yield { type: 'end', text, toolCalls, stop }
  }

  toAIError(err) {
    if (err instanceof AIError) return err
    // A failure inside the token function reaches here wrapped by the SDK.
    if (err?.cause instanceof AIError) return err.cause
    return this.options.describeError?.(err) ?? describeApiError(err, this.options.vendor)
  }
}

/** The neutral conversation, as Chat Completions messages. */
function toMessages(system, messages) {
  const out = [{ role: 'system', content: system }]
  let images = []

  // Pictures from a run of tool results go in one user message right after
  // them — tool messages must directly follow the call they answer.
  const flushImages = () => {
    if (!images.length) return
    out.push({
      role: 'user',
      content: [{ type: 'text', text: 'The image(s) returned by the tool call above:' }, ...images],
    })
    images = []
  }

  for (const m of messages) {
    if (m.role !== 'tool') flushImages()
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      const calls = m.toolCalls ?? []
      out.push({
        role: 'assistant',
        content: m.content || (calls.length ? null : ''),
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: c.arguments || '{}' },
                ...(c.extra ? { extra_content: c.extra } : {}),
              })),
            }
          : {}),
      })
    } else if (m.role === 'tool') {
      const prefix = m.isError ? 'ERROR: ' : ''
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      for (const block of m.content) {
        if (block.type === 'image') {
          images.push({ type: 'image_url', image_url: { url: `data:${block.mimeType};base64,${block.data}` } })
        }
      }
      const hasImage = m.content.some((b) => b.type === 'image')
      out.push({
        role: 'tool',
        tool_call_id: m.toolCallId,
        name: m.name,
        content: prefix + (text || (hasImage ? '(image attached below)' : '(no output)')),
      })
    }
  }
  flushImages()
  return out
}
