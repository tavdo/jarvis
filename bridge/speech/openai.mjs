import OpenAI, { toFile } from 'openai'
import {
  SpeechError,
  SpeechToTextProvider,
  TextToSpeechProvider,
  extensionFor,
} from './provider.mjs'

/**
 * OpenAI speech, opt-in with JARVIS_TTS_PROVIDER=openai and
 * JARVIS_STT_PROVIDER=openai. Uses the same server-side key as the brain.
 */

const statusOf = (err) => (err instanceof OpenAI.APIError && err.status ? err.status : 502)

export class OpenAITTS extends TextToSpeechProvider {
  constructor({ apiKey, baseURL, model, voice }) {
    super()
    this.client = new OpenAI({ apiKey, baseURL })
    this.model = model
    this.voice = voice
  }

  get name() {
    return 'openai'
  }

  async synthesize(text) {
    try {
      const res = await this.client.audio.speech.create({
        model: this.model,
        voice: this.voice,
        input: text,
        response_format: 'mp3',
        instructions:
          'A composed, dry British butler. Measured pace, understated, precise diction.',
      })
      return { contentType: 'audio/mpeg', body: res.body }
    } catch (err) {
      throw new SpeechError(statusOf(err), 'OpenAI speech failed')
    }
  }
}

export class OpenAISTT extends SpeechToTextProvider {
  constructor({ apiKey, baseURL, model, language }) {
    super()
    this.client = new OpenAI({ apiKey, baseURL })
    this.model = model
    this.language = language
  }

  get name() {
    return 'openai'
  }

  async transcribe(audio, type) {
    try {
      const file = await toFile(audio, `speech.${extensionFor(type)}`, { type })
      const res = await this.client.audio.transcriptions.create({
        file,
        model: this.model,
        ...(this.language === 'ka' ? { language: 'ka' } : {}),
      })
      return (res.text ?? '').trim()
    } catch (err) {
      throw new SpeechError(statusOf(err), 'OpenAI transcription failed')
    }
  }
}
