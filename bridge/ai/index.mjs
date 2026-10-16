import { OpenAIProvider } from './openai.mjs'
import { createGemini, createVertex } from './google.mjs'

export { AIError, AIProvider } from './provider.mjs'

/**
 * The provider named in config. One case per vendor; everything else in the
 * bridge holds an AIProvider and never asks which one.
 *
 * @param {typeof import('../config.mjs').ai} config
 * @returns {import('./provider.mjs').AIProvider}
 */
export function createProvider(config) {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config.openai)
    case 'gemini':
      return createGemini(config.gemini)
    case 'vertex':
      return createVertex(config.vertex)
    default:
      throw new Error(`unknown AI provider: ${config.provider}`)
  }
}
