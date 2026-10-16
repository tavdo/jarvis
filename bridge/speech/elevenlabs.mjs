import {
  SpeechError,
  SpeechToTextProvider,
  TextToSpeechProvider,
  extensionFor,
} from './provider.mjs'

/**
 * ElevenLabs: the George voice for speaking, Scribe for transcription. The key
 * stays here; the browser POSTs text or audio to the bridge and gets the result.
 */

/** The Georgian (Mkhedruli) alphabet. */
const GEORGIAN = /[\u10D0-\u10FF]/

export class ElevenLabsTTS extends TextToSpeechProvider {
  constructor({ apiKey, voiceId }) {
    super()
    this.apiKey = apiKey
    this.voiceId = voiceId
  }

  get name() {
    return 'elevenlabs'
  }

  async synthesize(text) {
    // Flash is the low-latency model — a conversation needs speed more than
    // it needs the last few percent of quality. But it has no Georgian: it
    // reads Georgian script as a transliteration in a foreign accent. v3 does
    // speak it, a beat slower, and refuses the latency option.
    const georgian = GEORGIAN.test(text)
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream` +
        // 22kHz mono is half the bytes of 44kHz and indistinguishable through
        // a laptop speaker; optimize_streaming_latency=3 trades a little
        // prosody for a much earlier first byte.
        `?output_format=mp3_22050_32${georgian ? '' : '&optimize_streaming_latency=3'}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: georgian ? 'eleven_v3' : 'eleven_flash_v2_5',
          voice_settings: {
            // v3 takes only 0, 0.5 or 1 here.
            stability: georgian ? 0.5 : 0.4,
            similarity_boost: 0.75,
            speed: 1.05,
          },
        }),
      },
    )
    if (!upstream.ok) {
      throw new SpeechError(upstream.status, `ElevenLabs speech failed (${upstream.status})`)
    }
    return { contentType: 'audio/mpeg', body: upstream.body }
  }
}

export class ElevenLabsSTT extends SpeechToTextProvider {
  constructor({ apiKey, language }) {
    super()
    this.apiKey = apiKey
    this.language = language
  }

  get name() {
    return 'elevenlabs'
  }

  async transcribe(audio, type) {
    const form = new FormData()
    form.append('model_id', 'scribe_v1')
    // Left to itself Scribe guesses the language per clip, which is fine for
    // English and mixed speech; a short Georgian phrase is better told.
    if (this.language === 'ka') form.append('language_code', 'kat')
    form.append('file', new Blob([audio], { type }), `speech.${extensionFor(type)}`)
    const upstream = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey },
      body: form,
    })
    if (!upstream.ok) {
      throw new SpeechError(upstream.status, `ElevenLabs transcription failed (${upstream.status})`)
    }
    const data = await upstream.json()
    return (data.text ?? '').trim()
  }
}
