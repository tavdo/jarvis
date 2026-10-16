import { BRIDGE_HTTP_URL } from '../config'

/**
 * What speech engines are actually available, decided once at boot.
 *
 * The whole point is that the app runs for anyone. With nothing configured it
 * uses the browser's own speech recognition and voice — no keys, it just works.
 * When the bridge has a speech provider configured (ElevenLabs, or OpenAI if
 * opted in), transcription and the voice upgrade automatically, with no flag to
 * set in the browser. This module is how the rest of the app learns which of
 * those worlds it is in, so voice.ts and tts.ts never have to guess.
 *
 * The premium paths live behind the bridge — it holds the key and makes the
 * calls, so the browser never sees a secret.
 */

export type Capabilities = {
  /** Server-side speech-to-text is reachable via the bridge. */
  stt: boolean
  /** Server-side text-to-speech is reachable via the bridge. */
  tts: boolean
  /** Which provider answers each, e.g. 'elevenlabs', 'openai', 'browser'. */
  sttProvider: string
  ttsProvider: string
  /** The language set in Settings: what he listens for and answers in. */
  language: 'en' | 'ka'
}

/** Browser-only until the probe says otherwise. Safe default: the app works. */
let current: Capabilities = { stt: false, tts: false, sttProvider: 'browser', ttsProvider: 'browser', language: 'en' }
let probed = false

/** The last known capabilities. Read synchronously by the voice and speech
 *  layers; accurate once `probeCapabilities` has resolved during boot. */
export function caps(): Capabilities {
  return current
}

export function capabilitiesProbed(): boolean {
  return probed
}

/**
 * Ask the bridge what it can do, once. Called during the boot sequence, before
 * the voice loop starts, so the first "Hey Jarvis" already uses the right
 * engine. Never throws: a failed probe simply leaves the browser fallback in
 * place, which is the correct behaviour when the bridge is unreachable.
 */
export async function probeCapabilities(): Promise<Capabilities> {
  try {
    const res = await fetch(`${BRIDGE_HTTP_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok) {
      const h = (await res.json()) as Partial<Capabilities>
      current = {
        stt: Boolean(h.stt),
        tts: Boolean(h.tts),
        sttProvider: h.sttProvider ?? 'browser',
        ttsProvider: h.ttsProvider ?? 'browser',
        language: h.language === 'ka' ? 'ka' : 'en',
      }
    }
  } catch {
    // Bridge down or slow — stay on the browser engines rather than blocking
    // boot on a health check that is only an optimisation.
  }
  probed = true
  return current
}

const LABELS: Record<string, string> = { elevenlabs: 'ElevenLabs', openai: 'OpenAI', browser: 'browser' }

/** The server-side voice's display name. */
export function ttsProviderLabel(): string {
  return LABELS[current.ttsProvider] ?? current.ttsProvider
}

/** A short human label for the HUD: what voice stack is actually in play. */
export function engineLabel(): string {
  const c = current
  if (c.stt && c.tts) return LABELS[c.ttsProvider] ?? c.ttsProvider
  if (c.tts) return `${ttsProviderLabel()} voice`
  return 'browser speech'
}
