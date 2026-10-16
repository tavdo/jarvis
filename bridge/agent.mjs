import { AIError } from './ai/index.mjs'

/**
 * One conversation: the memory, and the loop that turns a question into an
 * answer through as many tool calls as it takes.
 *
 * Memory lives here, in the application, not in any provider's session. Each
 * finished exchange is kept as two plain lines — what the user said and what
 * JARVIS said — and that is all a later turn sees. Tool calls, tool results,
 * page text and camera frames exist only for the turn that produced them: they
 * are the bulk of the tokens and most of the private data, and nothing in a
 * later turn needs them back verbatim.
 */
export class Conversation {
  /**
   * @param {{
   *   provider: import('./ai/provider.mjs').AIProvider,
   *   registry: import('./tools/registry.mjs').ToolRegistry,
   *   system: string | (() => string),
   *   maxSteps: number,
   *   historyTurns: number,
   * }} options
   */
  constructor({ provider, registry, system, maxSteps, historyTurns }) {
    this.provider = provider
    this.registry = registry
    this.system = system
    this.maxSteps = maxSteps
    this.historyTurns = historyTurns
    /** @type {import('./ai/provider.mjs').Message[]} */
    this.history = []
  }

  /**
   * Answer one question.
   *
   * @param {string} text
   * @param {{
   *   signal: AbortSignal,
   *   onText: (delta: string) => void,
   *   onTool: (label: string) => void,
   *   confirm: import('./tools/registry.mjs').ToolContext['confirm'],
   * }} io
   */
  async run(text, { signal, onText, onTool, confirm }) {
    /** @type {import('./ai/provider.mjs').Message[]} */
    const turn = [{ role: 'user', content: text }]
    const system = typeof this.system === 'function' ? this.system() : this.system
    let spoken = ''

    const say = (delta) => {
      spoken += delta
      onText(delta)
    }

    try {
      for (let step = 0; step < this.maxSteps; step++) {
        if (signal.aborted) throw aborted()

        let end = null
        let first = true
        for await (const event of this.provider.step({
          system,
          messages: [...this.history, ...turn],
          tools: this.registry.definitions(),
          signal,
        })) {
          if (event.type === 'text') {
            // Text from a later step continues the same spoken answer, so it
            // needs a space where one sentence ends and the next begins.
            const joiner = first && spoken && !/\s$/.test(spoken) ? ' ' : ''
            first = false
            say(joiner + event.delta)
          } else if (event.type === 'hosted_tool') {
            onTool(`web · ${event.name.replace(/_/g, ' ')}`)
          } else if (event.type === 'end') {
            end = event
          }
        }
        if (!end) throw new AIError('server', 'The model stream ended without an answer.')

        turn.push({ role: 'assistant', content: end.text, toolCalls: end.toolCalls })

        if (!end.toolCalls.length) {
          if (end.stop === 'max_output_tokens') say(' There is more, if you want it.')
          else if (end.stop === 'content_filter') say(' The model stopped that answer partway, sir. Try asking another way.')
          else if (end.stop === 'incomplete') say(' I was cut off there, sir. Ask me again.')
          return
        }

        for (const call of end.toolCalls) {
          if (signal.aborted) throw aborted()
          const result = await this.registry.execute(
            call.name,
            call.arguments,
            { confirm, signal },
            {
              onRun: (name) => {
                if (!this.registry.isQuiet(name)) onTool(this.registry.pretty(name))
              },
            },
          )
          turn.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: result.content,
            isError: result.isError,
          })
        }
      }
      say(' That is taking more steps than it should, sir. Ask me again if you need the rest.')
    } finally {
      this.remember(text, spoken)
    }
  }

  /** Keep the exchange as two lines, trimmed to the configured window. */
  remember(user, assistant) {
    if (this.historyTurns <= 0) return
    this.history.push(
      { role: 'user', content: user },
      { role: 'assistant', content: assistant.trim() || '(no answer was given)' },
    )
    const max = this.historyTurns * 2
    if (this.history.length > max) this.history = this.history.slice(-max)
  }
}

const aborted = () => new AIError('aborted', 'The turn was interrupted.')
