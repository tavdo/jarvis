import { z } from 'zod'

/**
 * The tool layer, independent of any AI provider.
 *
 * Every JARVIS tool is declared the same way it always was — a name, a
 * description, a zod shape and an async handler that returns
 * `{ content: [...], isError? }` — so the tool modules did not have to be
 * rewritten when the brain changed. What changed is who runs them: this file
 * validates the arguments, enforces the confirmation policy and executes the
 * handler, and the provider only ever sees plain JSON Schema definitions.
 *
 * Everything the model sends is treated as untrusted input. Arguments are
 * parsed and validated here, and the confirmation requirement is a property of
 * the tool in code — no argument, prompt or tool result can switch it off.
 */

/** OpenAI-compatible function names: letters, digits, underscore, dash. */
const NAME = /^[a-zA-Z0-9_-]{1,64}$/

/** Ceiling on what one tool result may put back into the conversation. */
const MAX_RESULT_CHARS = 60_000

/**
 * Declare one tool.
 *
 * @param {string} name
 * @param {string} description
 * @param {Record<string, import('zod').ZodType>} shape
 * @param {(args: any, ctx: ToolContext) => Promise<ToolResult>} handler
 * @param {{
 *   confirm?: (args: any) => ConfirmRequest | null | Promise<ConfirmRequest | null>,
 *   quiet?: boolean,
 * }} [options]
 *   confirm — the tool can change something in the world, so the user must
 *             approve the call. Returns what to show them, or null when these
 *             validated arguments are harmless (a mouse move, a new file) —
 *             decided here in code, never by the model.
 *   quiet   — the tool is the interface talking about itself (panels, theme),
 *             so it is not announced on the HUD as work being done.
 */
export function tool(name, description, shape, handler, options = {}) {
  return { name, description, shape, handler, ...options }
}

/**
 * A named set of tools, the unit the HUD's SYSTEMS rail lists. `quiet` marks
 * every tool in the group as quiet.
 */
export function toolGroup({ name, label, instructions = '', quiet = false, tools }) {
  return {
    name,
    label: label ?? name,
    instructions,
    tools: quiet ? tools.map((t) => ({ ...t, quiet: true })) : tools,
  }
}

/**
 * @typedef {{ type: 'text', text: string } | { type: 'image', data: string, mimeType: string }} ContentBlock
 * @typedef {{ content: ContentBlock[], isError?: boolean }} ToolResult
 * @typedef {{ action: string, detail?: string }} ConfirmRequest
 * @typedef {{
 *   confirm: (request: ConfirmRequest & { tool: string }) => Promise<boolean>,
 *   signal?: AbortSignal,
 * }} ToolContext
 */

const text = (t) => ({ type: 'text', text: t })
const failure = (t) => ({ isError: true, content: [text(t)] })

/** JSON Schema for a zod shape, in the subset function calling accepts. */
function toParameters(schema) {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
  delete json.$schema
  if (json.type !== 'object') return { type: 'object', properties: {} }
  json.properties ??= {}
  return json
}

export class ToolRegistry {
  /** @param {ReturnType<typeof toolGroup>[]} groups */
  constructor(groups) {
    this.groups = groups
    /** @type {Map<string, { group: any, def: any, schema: any, parameters: object }>} */
    this.tools = new Map()
    for (const group of groups) {
      for (const def of group.tools) {
        if (!NAME.test(def.name)) throw new Error(`invalid tool name: ${def.name}`)
        if (this.tools.has(def.name)) throw new Error(`duplicate tool name: ${def.name}`)
        const schema = z.object(def.shape ?? {})
        this.tools.set(def.name, { group, def, schema, parameters: toParameters(schema) })
      }
    }
  }

  /** Provider-neutral definitions: what the model is allowed to ask for. */
  definitions() {
    return [...this.tools.values()].map(({ def, parameters }) => ({
      name: def.name,
      description: def.description,
      parameters,
    }))
  }

  labels() {
    return this.groups.map((g) => g.label)
  }

  /** What the interface's Tools page lists: names, one-line purposes, and which ones ask first. */
  catalog() {
    return this.groups.map((g) => ({
      group: g.label,
      tools: g.tools.map((t) => ({
        name: t.name,
        summary: String(t.description ?? '').split(/(?<=\.)\s/)[0].slice(0, 160),
        asks: Boolean(t.confirm),
      })),
    }))
  }

  /** `jarvis_chrome · chrome navigate`, the form the HUD and fillers read. */
  pretty(name) {
    const entry = this.tools.get(name)
    if (!entry) return name
    return `${entry.group.name} · ${name.replace(/_/g, ' ')}`
  }

  isQuiet(name) {
    return Boolean(this.tools.get(name)?.def.quiet)
  }

  needsConfirmation(name) {
    return Boolean(this.tools.get(name)?.def.confirm)
  }

  /**
   * Run one tool call from the model.
   *
   * @param {string} name
   * @param {string | object} rawArgs - JSON text as the model produced it
   * @param {ToolContext} ctx
   * @param {{ onRun?: (name: string) => void }} [hooks]
   *   onRun fires only once the call is validated and approved, so the HUD
   *   never announces work that is refused.
   * @returns {Promise<ToolResult>}
   */
  async execute(name, rawArgs, ctx, hooks = {}) {
    const entry = this.tools.get(name)
    if (!entry) return failure(`There is no tool called "${name}".`)
    const { def, schema } = entry

    let args = rawArgs
    if (typeof rawArgs === 'string') {
      try {
        args = rawArgs.trim() ? JSON.parse(rawArgs) : {}
      } catch {
        return failure(`The arguments for ${name} were not valid JSON.`)
      }
    }
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return failure(`The arguments for ${name} must be a JSON object.`)
    }

    const parsed = schema.safeParse(args)
    if (!parsed.success) {
      return failure(`Invalid arguments for ${name}: ${z.prettifyError(parsed.error)}`)
    }

    if (def.confirm) {
      let request
      try {
        request = await def.confirm(parsed.data)
      } catch (err) {
        return failure(`${name} was not run: ${err?.message ?? err}`)
      }
      if (request) {
        let approved = false
        try {
          approved = await ctx.confirm({ ...request, tool: name })
        } catch {
          approved = false
        }
        console.log(`[jarvis] confirm ${name}: ${approved ? 'approved' : 'declined'}`)
        if (!approved) {
          return failure(
            'The user did not approve this action, so it was not performed. ' +
              'Do not retry it unless they ask again.',
          )
        }
      }
    }

    if (ctx.signal?.aborted) return failure('The turn was interrupted.')
    hooks.onRun?.(name)

    try {
      const result = await def.handler(parsed.data, ctx)
      return normalise(result)
    } catch (err) {
      console.error(`[jarvis] tool ${name} failed:`, err)
      return failure(`${name} failed: ${err?.message ?? err}`)
    }
  }
}

/** Whatever a handler returned, as a well-formed and bounded result. */
function normalise(result) {
  const blocks = Array.isArray(result?.content) ? result.content : []
  const content = []
  let budget = MAX_RESULT_CHARS
  for (const block of blocks) {
    if (block?.type === 'image' && typeof block.data === 'string' && block.mimeType) {
      content.push({ type: 'image', data: block.data, mimeType: block.mimeType })
    } else if (block?.type === 'text' && typeof block.text === 'string') {
      if (budget <= 0) continue
      const t = block.text.length > budget ? `${block.text.slice(0, budget)}\n[truncated]` : block.text
      budget -= t.length
      content.push(text(t))
    }
  }
  if (!content.length) content.push(text('Done.'))
  return { content, isError: result?.isError === true }
}
