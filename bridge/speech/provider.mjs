/**
 * Speech, behind two small interfaces so the vendor can change without the
 * browser noticing. The browser only ever talks to the bridge's /tts and /stt
 * endpoints; which provider answers them is decided here, and when neither is
 * configured the browser falls back to its own speech engines.
 */

export class TextToSpeechProvider {
  /** @returns {string} */
  get name() {
    throw new Error('not implemented')
  }

  /**
   * @param {string} text
   * @returns {Promise<{ contentType: string, body: AsyncIterable<Uint8Array> }>}
   *   Streamed audio. Throws SpeechError on failure.
   */
  async synthesize(_text) {
    throw new Error('not implemented')
  }
}

export class SpeechToTextProvider {
  /** @returns {string} */
  get name() {
    throw new Error('not implemented')
  }

  /**
   * @param {Buffer} audio
   * @param {string} mimeType - as the browser's MediaRecorder reported it
   * @returns {Promise<string>} the transcript, possibly empty
   */
  async transcribe(_audio, _mimeType) {
    throw new Error('not implemented')
  }
}

export class SpeechError extends Error {
  /** @param {number} status - HTTP status to hand back to the browser */
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** The file extension is the only codec hint some transcribers get. */
export function extensionFor(type) {
  if (type.includes('ogg')) return 'ogg'
  if (type.includes('mp4') || type.includes('mpeg')) return 'mp4'
  if (type.includes('wav')) return 'wav'
  return 'webm'
}
