import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applySavedSettings } from './settings.mjs'

/**
 * Every bridge setting, read in one place.
 *
 * The bridge is the only process that ever holds a secret. Values come from
 * the shell environment first, then from `.env.local` and `.env` in the project
 * root — loaded here, server-side. Vite only ever hands VITE_-prefixed values
 * to the browser, so OPENAI_API_KEY in either file never reaches the page.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// Shell values win over files, and .env.local wins over .env: loadEnvFile never
// overwrites a variable that is already set. What was saved from the Settings
// page goes in first, so it wins over both files (see settings.mjs).
applySavedSettings()
for (const name of ['.env.local', '.env']) {
  const path = join(ROOT, name)
  if (existsSync(path) && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(path)
    } catch (err) {
      console.warn(`[jarvis] could not read ${name}: ${err.message}`)
    }
  }
}

/** Blank counts as unset, the same rule src/config.ts applies to VITE_ values. */
function str(name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function num(name, fallback, min, max) {
  const value = Number(str(name))
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function flag(name, fallback) {
  const value = str(name)?.toLowerCase()
  if (value === undefined) return fallback
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function list(name) {
  return (str(name) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function choice(name, allowed, fallback) {
  const value = str(name)?.toLowerCase()
  if (value === undefined) return fallback
  if (allowed.includes(value)) return value
  console.warn(`[jarvis] ${name}="${value}" is not one of ${allowed.join(' | ')} — using "${fallback}".`)
  return fallback
}

// ---------------------------------------------------------------------------
// The brain
// ---------------------------------------------------------------------------

/**
 * Which service answers: openai, gemini (Google AI Studio key) or vertex
 * (Gemini through Google Cloud, billed to Cloud credits).
 */
const PROVIDER = choice('JARVIS_AI_PROVIDER', ['openai', 'gemini', 'vertex'], 'openai')

/**
 * The one place each model is named — OPENAI_MODEL, GEMINI_MODEL or
 * VERTEX_MODEL, for the provider in use. Nothing else in the project refers to
 * a model by name.
 */
const MODEL = str('OPENAI_MODEL') ?? 'gpt-5-mini'
const GEMINI_MODEL = str('GEMINI_MODEL') ?? 'gemini-3.8-flash'
const VERTEX_MODEL = str('VERTEX_MODEL') ?? 'google/gemini-3.8-flash'

/**
 * Reasoning effort, for reasoning models only — sending it to a model that
 * does not reason is a request error. Unset means: 'low' for the gpt-5 and o
 * series, where a voice assistant needs the speed, and omitted otherwise.
 * 'off' always omits it.
 */
function reasoningEffort() {
  const raw = str('OPENAI_REASONING_EFFORT')?.toLowerCase()
  if (raw === 'off') return undefined
  if (raw) return raw
  return /^(gpt-5|o\d)/i.test(MODEL) ? 'low' : undefined
}

/** Gemini's reasoning effort: 'low' unless set; 'off' leaves it to the model. */
function geminiEffort() {
  const raw = str('GEMINI_REASONING_EFFORT')?.toLowerCase()
  if (raw === 'off') return undefined
  return raw ?? 'low'
}

export const ai = {
  provider: PROVIDER,
  openai: {
    apiKey: str('OPENAI_API_KEY'),
    /** Optional; for a proxy or an OpenAI-compatible gateway. */
    baseURL: str('OPENAI_BASE_URL'),
    model: MODEL,
    reasoningEffort: reasoningEffort(),
    /** OpenAI's hosted web search tool, replacing the old built-in search. */
    webSearch: flag('OPENAI_WEB_SEARCH', true),
    maxOutputTokens: num('OPENAI_MAX_OUTPUT_TOKENS', 4096, 256, 128_000),
  },
  gemini: {
    apiKey: str('GEMINI_API_KEY'),
    baseURL: str('GEMINI_BASE_URL') ?? 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: GEMINI_MODEL,
    reasoningEffort: geminiEffort(),
    maxOutputTokens: num('GEMINI_MAX_OUTPUT_TOKENS', 4096, 256, 65_536),
  },
  vertex: {
    project: str('VERTEX_PROJECT') ?? str('GOOGLE_CLOUD_PROJECT'),
    location: str('VERTEX_LOCATION') ?? 'global',
    model: VERTEX_MODEL,
    reasoningEffort: geminiEffort(),
    maxOutputTokens: num('GEMINI_MAX_OUTPUT_TOKENS', 4096, 256, 65_536),
  },
  /** Model calls per turn, so a tool loop cannot run away. */
  maxSteps: num('JARVIS_MAX_TOOL_STEPS', 12, 1, 50),
  /** Completed exchanges kept as context for the next turn. */
  historyTurns: num('JARVIS_HISTORY_TURNS', 12, 0, 100),
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export const speech = {
  /**
   * The language he listens for and answers in. In English he still answers
   * Georgian in Georgian; in Georgian, recognition is told to expect it.
   */
  language: choice('JARVIS_LANGUAGE', ['en', 'ka'], 'en'),
  /** auto = ElevenLabs when a key is present, otherwise the browser's own. */
  tts: choice('JARVIS_TTS_PROVIDER', ['auto', 'elevenlabs', 'openai', 'browser'], 'auto'),
  stt: choice('JARVIS_STT_PROVIDER', ['auto', 'elevenlabs', 'openai', 'browser'], 'auto'),
  elevenlabs: {
    apiKey: str('ELEVENLABS_API_KEY'),
    voiceId: str('JARVIS_VOICE_ID') ?? 'JBFqnCBsd6RMkjVDRZzb',
  },
  openai: {
    ttsModel: str('OPENAI_TTS_MODEL') ?? 'gpt-4o-mini-tts',
    ttsVoice: str('OPENAI_TTS_VOICE') ?? 'onyx',
    sttModel: str('OPENAI_STT_MODEL') ?? 'gpt-4o-mini-transcribe',
  },
}

// ---------------------------------------------------------------------------
// The bridge itself
// ---------------------------------------------------------------------------

const home = homedir()

export const bridge = {
  port: num('JARVIS_BRIDGE_PORT', 8787, 1, 65535),
  allowedOrigins: list('JARVIS_ALLOWED_ORIGINS'),
  allowNoOrigin: flag('JARVIS_ALLOW_NO_ORIGIN', false),
  /** Extra roots the /file image endpoint may serve from. */
  fileRoots: list('JARVIS_FILE_ROOTS'),
  /** How long JARVIS waits for a yes or no before treating it as no. */
  confirmTimeoutMs: num('JARVIS_CONFIRM_TIMEOUT_MS', 30_000, 5_000, 300_000),
  /** City for the interface's weather readout, e.g. "Tbilisi". Unset: no weather. */
  weatherCity: str('JARVIS_WEATHER_CITY'),
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * Folders the file tools may list, read and recycle from. Default: Desktop,
 * Documents and Downloads. `none` turns the file tools off entirely.
 */
function readRoots() {
  const raw = list('JARVIS_READ_ROOTS')
  if (raw.length === 1 && raw[0].toLowerCase() === 'none') return []
  if (raw.length) return raw
  if (process.platform === 'win32') {
    return [...'CDEFGHIJKLMNOPQRSTUVWXYZ'].map((d) => `${d}:\\`).filter((p) => existsSync(p))
  }
  return [home]
}

export const tools = {
  readRoots: readRoots(),
  /** Windows, keyboard, volume, power and commands — each change confirmed. */
  pcControl: flag('JARVIS_PC_CONTROL', true),
  /** The confirmed PowerShell/cmd runner, separately switchable. */
  commands: flag('JARVIS_ALLOW_COMMANDS', true),
  chrome: {
    /** Which Chrome or Edge to launch. Found automatically when unset. */
    path: str('JARVIS_CHROME_PATH'),
    debugPort: num('JARVIS_CHROME_DEBUG_PORT', 9222, 1024, 65535),
    /** JARVIS's own browser profile — never your everyday one. */
    profileDir: str('JARVIS_CHROME_PROFILE') ?? join(home, '.jarvis', 'chrome-profile'),
    autoLaunch: flag('JARVIS_CHROME_AUTOLAUNCH', true),
  },
}

/** Who JARVIS is talking to, and the standing instructions they gave him in Settings. */
export const persona = {
  userName: str('JARVIS_USER_NAME'),
  instructions: str('JARVIS_INSTRUCTIONS')?.slice(0, 2000),
}

export const debug = flag('JARVIS_DEBUG', false)

/** Anything that looks like an API key, masked, for logs and error text. */
export function redact(text) {
  return String(text ?? '')
    .replace(/\b(sk|xi|el)[-_][A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/\bAQ\.[0-9A-Za-z_.-]{20,}/g, '[redacted]')
    .replace(/\bya29\.[0-9A-Za-z_.-]{10,}/g, '[redacted]')
}
