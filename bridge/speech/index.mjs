import { ElevenLabsSTT, ElevenLabsTTS } from './elevenlabs.mjs'
import { OpenAISTT, OpenAITTS } from './openai.mjs'

export { SpeechError } from './provider.mjs'

/**
 * Pick the speech providers from config. `null` means the browser handles that
 * direction itself — its own SpeechRecognition and speechSynthesis.
 *
 * auto keeps the original behaviour: ElevenLabs when its key is present, the
 * browser otherwise. OpenAI speech is opt-in, because it costs per sentence
 * and a voice assistant says a lot of sentences.
 *
 * @param {typeof import('../config.mjs').speech} speech
 * @param {typeof import('../config.mjs').ai.openai} openai
 */
export function createSpeech(speech, openai) {
  const eleven = speech.elevenlabs
  const warnings = []

  const pick = (which, make) => {
    const wanted = speech[which]
    if (wanted === 'browser') return null
    if (wanted === 'openai') {
      if (openai.apiKey) return make.openai()
      warnings.push(`${which.toUpperCase()} provider "openai" needs OPENAI_API_KEY — using the browser.`)
      return null
    }
    if (wanted === 'elevenlabs' && !eleven.apiKey) {
      warnings.push(`${which.toUpperCase()} provider "elevenlabs" needs ELEVENLABS_API_KEY — using the browser.`)
      return null
    }
    return eleven.apiKey ? make.elevenlabs() : null
  }

  const tts = pick('tts', {
    elevenlabs: () => new ElevenLabsTTS(eleven),
    openai: () =>
      new OpenAITTS({
        apiKey: openai.apiKey,
        baseURL: openai.baseURL,
        model: speech.openai.ttsModel,
        voice: speech.openai.ttsVoice,
      }),
  })
  const stt = pick('stt', {
    elevenlabs: () => new ElevenLabsSTT({ ...eleven, language: speech.language }),
    openai: () =>
      new OpenAISTT({
        apiKey: openai.apiKey,
        baseURL: openai.baseURL,
        model: speech.openai.sttModel,
        language: speech.language,
      }),
  })

  return { tts, stt, warnings }
}
