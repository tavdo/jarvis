import OpenAI from 'openai'
import { AIError, AIProvider } from './provider.mjs'
import { redact } from '../config.mjs'

/**
 * OpenAI, through the official SDK and the Responses API.
 *
 * The Responses API rather than Chat Completions for two reasons that matter
 * here: tool results can carry images (the camera, browser screenshots and
 * desktop screenshots all hand the model a picture), and OpenAI's hosted web
 * search is available as a tool, which replaces the search the old brain had
 * built in.
 *
 * Requests are stateless — `store: false` and the whole relevant conversation
 * sent each time — so the history the app decides to keep is exactly what the
 * model sees, and nothing is retained on OpenAI's side for a later turn.
 */
export class OpenAIProvider extends AIProvider {
  /**
   * @param {{
   *   apiKey?: string, baseURL?: string, model: string,
   *   reasoningEffort?: string, webSearch: boolean, maxOutputTokens: number,
   * }} options
   */
  constructor(options) {
    super()
    this.options = options
    this.client = options.apiKey
      ? new OpenAI({
          apiKey: options.apiKey,
          baseURL: options.baseURL,
          maxRetries: 2,
          timeout: 90_000,
        })
      : null
  }

  get name() {
    return 'openai'
  }

  get model() {
    return this.options.model
  }

  get webSearch() {
    return this.options.webSearch
  }

  requireClient() {
    if (!this.client) {
      throw new AIError(
        'missing_key',
        'OPENAI_API_KEY is not set. Add it to the .env file in the JARVIS folder and restart the bridge.',
      )
    }
    return this.client
  }

  /**
   * A one-word request. Looking the model up would be free, but it succeeds on
   * an account with no credit; this proves the key, the model and the billing.
   */
  async check() {
    try {
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
    const { model, reasoningEffort, webSearch, maxOutputTokens } = this.options

    const params = {
      model,
      instructions: system,
      input: toInput(messages),
      tools: [
        ...tools.map((t) => ({
          type: 'function',
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          // The schemas are deliberately lenient (optional fields, tolerant
          // types); strict mode requires every field and rejects that shape.
          strict: false,
        })),
        ...(webSearch ? [{ type: 'web_search' }] : []),
      ],
      stream: true,
      store: false,
      max_output_tokens: maxOutputTokens,
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    }

    let stream
    try {
      stream = await client.responses.create(params, { signal })
    } catch (err) {
      throw this.toAIError(err)
    }

    let text = ''
    let stop = 'completed'
    const toolCalls = []

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'response.output_text.delta':
            if (event.delta) {
              text += event.delta
              yield { type: 'text', delta: event.delta }
            }
            break

          case 'response.output_item.added':
            if (event.item?.type === 'web_search_call') {
              yield { type: 'hosted_tool', name: 'web_search' }
            }
            break

          case 'response.output_item.done':
            if (event.item?.type === 'function_call') {
              toolCalls.push({
                id: event.item.call_id,
                name: event.item.name,
                arguments: event.item.arguments ?? '',
              })
            }
            break

          case 'response.incomplete':
            stop = event.response?.incomplete_details?.reason ?? 'incomplete'
            break

          case 'response.failed':
            throw new AIError(
              'server',
              `OpenAI could not complete the answer: ${redact(event.response?.error?.message ?? 'unknown error')}`,
            )

          case 'error':
            throw new AIError(
              event.code === 'rate_limit_exceeded' ? 'rate_limit' : 'server',
              `OpenAI reported an error: ${redact(event.message ?? 'unknown error')}`,
            )
        }
      }
    } catch (err) {
      throw this.toAIError(err)
    }

    yield { type: 'end', text, toolCalls, stop }
  }

  /** Any failure, as a message fit for the screen. Never includes the key. */
  toAIError(err) {
    return describeApiError(err, {
      service: 'OpenAI',
      model: this.options.model,
      keyVar: 'OPENAI_API_KEY',
      modelVar: 'OPENAI_MODEL',
      billing: 'platform.openai.com/settings/organization/billing',
    })
  }
}

/**
 * An SDK failure as an AIError: a message fit for the screen and for speech,
 * naming the setting to fix. Shared by every provider that talks through the
 * OpenAI SDK, OpenAI's own API or a compatible one. Never includes the key.
 *
 * @param {unknown} err
 * @param {{ service: string, model: string, keyVar: string, modelVar: string, billing: string }} vendor
 */
export function describeApiError(err, vendor) {
  if (err instanceof AIError) return err
  const { service, model, keyVar, modelVar, billing } = vendor

  if (err instanceof OpenAI.APIUserAbortError || err?.name === 'AbortError') {
    return new AIError('aborted', 'The request was cancelled.', { cause: err })
  }
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return new AIError('timeout', `${service} took too long to answer. Try again.`, { cause: err })
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new AIError('network', `Could not reach ${service}. Check the internet connection.`, { cause: err })
  }
  if (err instanceof OpenAI.APIError) {
    const status = err.status
    const code = err.code ?? err.error?.code
    // Billing and rate errors can also arrive mid-stream, with no HTTP status
    // at all, so they are recognised by type and code as well.
    const type = err.type ?? err.error?.type
    if (type === 'insufficient_quota' || code === 'insufficient_quota' || code === 'credit_balance_exhausted') {
      return new AIError(
        'quota',
        `The ${service} account is out of credit or over its quota. Add credit at ${billing}.`,
        { status },
      )
    }
    if (code === 'rate_limit_exceeded') {
      return new AIError('rate_limit', `${service} is rate limiting requests. Wait a moment and try again.`, { status })
    }
    if (status === 401 || code === 'invalid_api_key') {
      return new AIError('invalid_key', `${service} rejected the API key. Check ${keyVar} in the .env file.`, { status })
    }
    if (status === 404 || code === 'model_not_found') {
      return new AIError(
        'model_unavailable',
        `The model "${model}" is not available to this API key. Set ${modelVar} to a model your account can use.`,
        { status },
      )
    }
    if (status === 403) {
      return new AIError(
        'permission',
        `This API key is not allowed to use "${model}" or one of the requested features.`,
        { status },
      )
    }
    if (status === 429) {
      return new AIError('rate_limit', `${service} is rate limiting requests. Wait a moment and try again.`, { status })
    }
    if (status === 400) {
      return new AIError(
        'bad_request',
        `${service} rejected the request: ${redact(err.error?.message ?? err.message)}`,
        { status },
      )
    }
    if (status >= 500) {
      return new AIError('server', `${service} had a server error. Try again shortly.`, { status })
    }
    return new AIError('unknown', `${service} request failed: ${redact(err.message)}`, { status })
  }
  return new AIError('unknown', `The AI request failed: ${redact(err?.message ?? err)}`, { cause: err })
}

/** The neutral conversation, as Responses API input items. */
function toInput(messages) {
  const input = []
  for (const m of messages) {
    if (m.role === 'user') {
      input.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      if (m.content) input.push({ role: 'assistant', content: m.content })
      for (const call of m.toolCalls ?? []) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments || '{}',
        })
      }
    } else if (m.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: m.toolCallId, output: toOutput(m) })
    }
  }
  return input
}

/** Text stays a string; anything with a picture in it becomes a content list. */
function toOutput(m) {
  const prefix = m.isError ? 'ERROR: ' : ''
  const hasImage = m.content.some((b) => b.type === 'image')
  if (!hasImage) {
    return prefix + m.content.map((b) => b.text).join('\n')
  }
  const out = []
  if (prefix) out.push({ type: 'input_text', text: prefix.trim() })
  for (const block of m.content) {
    if (block.type === 'text') out.push({ type: 'input_text', text: block.text })
    else out.push({ type: 'input_image', image_url: `data:${block.mimeType};base64,${block.data}`, detail: 'auto' })
  }
  return out
}
