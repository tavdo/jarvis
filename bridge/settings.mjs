import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * The settings the interface's Settings page can change.
 *
 * Ordinary choices live in ~/.jarvis/settings.json and are laid over the
 * environment before config.mjs reads it, so they win over .env but not over
 * a variable set in the shell. API keys are different: they are written to
 * the git-ignored .env (or .env.local, if that is where the key already is)
 * and never read back out — the page only ever learns whether one is set.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FILE = join(homedir(), '.jarvis', 'settings.json')

/** Setting → the environment variable config.mjs reads it from. */
const ENV = {
  provider: 'JARVIS_AI_PROVIDER',
  openaiModel: 'OPENAI_MODEL',
  geminiModel: 'GEMINI_MODEL',
  weatherCity: 'JARVIS_WEATHER_CITY',
  pcControl: 'JARVIS_PC_CONTROL',
  commands: 'JARVIS_ALLOW_COMMANDS',
  userName: 'JARVIS_USER_NAME',
  instructions: 'JARVIS_INSTRUCTIONS',
  voiceId: 'JARVIS_VOICE_ID',
  language: 'JARVIS_LANGUAGE',
}

const KEY_ENV = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
}

const model = z.string().trim().max(80).regex(/^[\w.\-/:]*$/, 'letters, digits and . - / : only')
const oneLine = (max) => z.string().trim().max(max).regex(/^[^\r\n]*$/, 'one line only')

const Settings = z
  .object({
    provider: z.enum(['openai', 'gemini', 'vertex']),
    openaiModel: model,
    geminiModel: model,
    weatherCity: oneLine(80),
    pcControl: z.boolean(),
    commands: z.boolean(),
    userName: oneLine(40),
    instructions: z.string().trim().max(2000),
    // Goes into an ElevenLabs URL path, so letters and digits only.
    voiceId: z.string().trim().regex(/^[A-Za-z0-9]{10,40}$/, 'an ElevenLabs voice ID is 10–40 letters and digits'),
    language: z.enum(['en', 'ka']),
  })
  .partial()
  .strict()

/** Blank leaves the stored key alone; there is no way to read one back. */
const apiKey = z
  .string()
  .trim()
  .max(300)
  .regex(/^([A-Za-z0-9_\-.:]{10,})?$/, 'that does not look like an API key')

const Update = z
  .object({
    settings: Settings.default({}),
    keys: z.object({ openai: apiKey, gemini: apiKey, elevenlabs: apiKey }).partial().strict().default({}),
  })
  .strict()

function readSaved() {
  try {
    const parsed = Settings.safeParse(JSON.parse(readFileSync(FILE, 'utf8')))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

/**
 * Lay the saved settings over the environment. Called by config.mjs before it
 * loads .env, so these win over the file; anything already set in the shell
 * is left as it is.
 */
export function applySavedSettings() {
  for (const [name, value] of Object.entries(readSaved())) {
    const env = ENV[name]
    if (!env || process.env[env] !== undefined) continue
    process.env[env] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
  }
}

/** Everything the Settings page shows. Keys appear only as set / not set. */
export function publicSettings(config) {
  return {
    provider: config.ai.provider,
    openaiModel: config.ai.openai.model,
    geminiModel: config.ai.gemini.model,
    weatherCity: config.bridge.weatherCity ?? '',
    pcControl: config.tools.pcControl,
    commands: config.tools.commands,
    userName: config.persona.userName ?? '',
    instructions: config.persona.instructions ?? '',
    voiceId: config.speech.elevenlabs.voiceId,
    language: config.speech.language,
    keys: {
      openai: Boolean(config.ai.openai.apiKey),
      gemini: Boolean(config.ai.gemini.apiKey),
      elevenlabs: Boolean(config.speech.elevenlabs.apiKey),
    },
  }
}

/** Replace `NAME=...` in an env file's text, or add it at the end. */
function setEnvLine(text, name, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.length ? text.split(/\r?\n/) : []
  const at = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?${name}\\s*=`).test(l))
  if (at >= 0) lines[at] = `${name}=${value}`
  else {
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    lines.push(`${name}=${value}`, '')
  }
  return lines.join(eol)
}

function envFileFor(name) {
  const local = join(ROOT, '.env.local')
  if (existsSync(local) && new RegExp(`^\\s*(export\\s+)?${name}\\s*=`, 'm').test(readFileSync(local, 'utf8'))) {
    return local
  }
  return join(ROOT, '.env')
}

/**
 * Validate and store an update from the Settings page. Throws a plain-language
 * error for anything that does not validate; nothing is written in that case.
 * @returns {{ changed: string[] }} names of what changed — never values.
 */
export function saveSettings(body) {
  const parsed = Update.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`${issue.path.join('.') || 'settings'}: ${issue.message}`)
  }
  const { settings, keys } = parsed.data
  const changed = []

  if (Object.keys(settings).length) {
    const next = { ...readSaved(), ...settings }
    mkdirSync(join(homedir(), '.jarvis'), { recursive: true })
    writeFileSync(FILE, JSON.stringify(next, null, 2))
    changed.push(...Object.keys(settings))
  }

  for (const [name, value] of Object.entries(keys)) {
    if (!value) continue
    const env = KEY_ENV[name]
    const file = envFileFor(env)
    const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    writeFileSync(file, setEnvLine(text, env, value))
    changed.push(`${name} key`)
  }
  return { changed }
}
