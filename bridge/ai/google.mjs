import { execFile } from 'node:child_process'
import { AIError } from './provider.mjs'
import { ChatCompletionsProvider } from './chat-completions.mjs'
import { redact } from '../config.mjs'

/**
 * Gemini, two ways in. Same models, different billing:
 *
 *   gemini — Google AI Studio, with an API key. Has a free tier (rate limited;
 *            Google may use free-tier traffic to improve its products).
 *   vertex — Vertex AI in a Google Cloud project, signed in with the gcloud
 *            CLI. Billed to the Cloud billing account, so Cloud credits such
 *            as the $300 welcome credit pay for it; AI Studio usage they don't.
 *
 * Both are reached through their OpenAI-compatible Chat Completions endpoints.
 */

export function createGemini(cfg) {
  return new ChatCompletionsProvider({
    name: 'gemini',
    model: cfg.model,
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
    fetch: googleFetch,
    // The free tier allows only a few requests a day for some models.
    lightCheck: true,
    reasoningEffort: cfg.reasoningEffort,
    maxOutputTokens: cfg.maxOutputTokens,
    missingKey:
      'GEMINI_API_KEY is not set. Get a free key at aistudio.google.com/apikey, put it in the .env file and restart the bridge.',
    vendor: {
      service: 'Gemini',
      model: cfg.model,
      keyVar: 'GEMINI_API_KEY',
      modelVar: 'GEMINI_MODEL',
      billing: 'aistudio.google.com',
    },
    describeError: (err) => googleError(err, { keyFix: 'Check GEMINI_API_KEY in the .env file.', model: cfg.model, modelVar: 'GEMINI_MODEL' }),
  })
}

export function createVertex(cfg) {
  const { project, location } = cfg
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`
  return new ChatCompletionsProvider({
    name: 'vertex',
    model: cfg.model,
    baseURL: `https://${host}/v1beta1/projects/${encodeURIComponent(project ?? '')}/locations/${encodeURIComponent(location)}/endpoints/openapi`,
    apiKey: project ? gcloudToken : undefined,
    fetch: googleFetch,
    reasoningEffort: cfg.reasoningEffort,
    maxOutputTokens: cfg.maxOutputTokens,
    missingKey:
      'VERTEX_PROJECT is not set. Put your Google Cloud project id in the .env file and restart the bridge.',
    vendor: {
      service: 'Vertex AI',
      model: cfg.model,
      keyVar: 'the gcloud sign-in',
      modelVar: 'VERTEX_MODEL',
      billing: 'console.cloud.google.com/billing',
    },
    describeError: (err) =>
      googleError(err, {
        keyFix: 'Sign in again with: gcloud auth application-default login',
        model: cfg.model,
        modelVar: 'VERTEX_MODEL',
        vertex: true,
      }),
  })
}

/**
 * Google can wrap an error body in a list — `[{"error": {...}}]` — where the
 * SDK expects `{"error": {...}}`, and the SDK then drops the message. Failed
 * responses are unwrapped so the real reason (a bad key, a quota) survives.
 */
async function googleFetch(url, init) {
  const res = await fetch(url, init)
  if (res.ok) return res
  const text = await res.text()
  let body = text
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed) && parsed[0]?.error) body = JSON.stringify(parsed[0])
  } catch {
    /* not JSON — passed on as it came */
  }
  const headers = new Headers(res.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  return new Response(body, { status: res.status, statusText: res.statusText, headers })
}

/**
 * Google's failures, in Google's words. Its compatibility layer reports some
 * things differently from OpenAI — a bad key is a 400, and a used-up free tier
 * is a 429 that is really a quota rather than a burst limit.
 */
function googleError(err, { keyFix, model, modelVar, vertex = false }) {
  if (err instanceof AIError) return err
  const status = err?.status
  const message = String(err?.error?.message ?? err?.message ?? '')

  if (/API key not valid|valid API key|API_KEY_INVALID|invalid authentication|UNAUTHENTICATED/i.test(message) || status === 401) {
    return new AIError('invalid_key', `Google rejected the credentials. ${keyFix}`, { status })
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(message)) {
    const details = JSON.stringify(err?.error?.details ?? '')
    if (!vertex && /PerDay/i.test(details)) {
      const wait = /retry in (?:(\d+)h)?(?:(\d+)m)?/i.exec(message)
      const when = wait?.[1] ? `in about ${wait[1]} hour${wait[1] === '1' ? '' : 's'}` : wait?.[2] ? `in about ${wait[2]} minutes` : 'at midnight Pacific time'
      return new AIError(
        'quota',
        `Today's Gemini free tier requests for "${model}" are used up. They reset ${when}. Until then, set ${modelVar} to another model, or turn on billing in AI Studio.`,
        { status },
      )
    }
    return vertex
      ? new AIError('quota', 'Vertex AI quota exhausted for this project. Wait a minute, or check quotas and billing in the Google Cloud console.', { status })
      : new AIError(
          'rate_limit',
          'The Gemini free tier limit was reached. Wait a minute, or until tomorrow if it was the daily limit; turning on billing in AI Studio raises it.',
          { status },
        )
  }
  if (status === 404 || /not found|is not supported|NOT_FOUND/i.test(message) && /model/i.test(message)) {
    return new AIError(
      'model_unavailable',
      `The model "${model}" is not available here. Set ${modelVar} to a model your project can use.`,
      { status },
    )
  }
  if (status === 403 || /PERMISSION_DENIED/i.test(message)) {
    return new AIError(
      'permission',
      vertex
        ? `Vertex AI refused: ${redact(message).slice(0, 200)} Check that the Vertex AI API is enabled and billing is linked for this project.`
        : `Gemini refused: ${redact(message).slice(0, 200)}`,
      { status },
    )
  }
  if (status === 503 || /high demand|overloaded|UNAVAILABLE/i.test(message)) {
    return new AIError(
      'server',
      `Google's servers are busy with "${model}" right now. Try again in a moment, or set ${modelVar} to another model.`,
      { status },
    )
  }
  if (/FAILED_PRECONDITION|location is not supported|User location/i.test(message)) {
    return new AIError('permission', `Gemini is not available from here: ${redact(message).slice(0, 200)}`, { status })
  }
  return null
}

// ---------------------------------------------------------------------------
// Vertex AI sign-in
// ---------------------------------------------------------------------------

let cached = { token: '', expires: 0 }

/**
 * An access token from the gcloud CLI's application-default credentials.
 * Tokens last an hour; one is reused for 45 minutes. Nothing here takes input,
 * so the command line is fixed.
 */
async function gcloudToken() {
  if (cached.token && Date.now() < cached.expires) return cached.token
  const token = await new Promise((resolve, reject) => {
    const args = ['auth', 'application-default', 'print-access-token']
    const done = (err, stdout, stderr) => {
      if (err) {
        const missing = err.code === 'ENOENT' || /not recognized|not found/i.test(String(stderr) + err.message)
        reject(
          new AIError(
            'missing_key',
            missing
              ? 'Vertex AI needs the Google Cloud CLI. Install it from cloud.google.com/sdk, then run: gcloud auth application-default login'
              : 'Vertex AI could not get a sign-in token. Run: gcloud auth application-default login',
          ),
        )
        return
      }
      resolve(String(stdout).trim())
    }
    // gcloud is a .cmd on Windows, which needs cmd.exe to run.
    if (process.platform === 'win32') {
      execFile('cmd.exe', ['/d', '/s', '/c', `gcloud ${args.join(' ')}`], { timeout: 30_000, windowsHide: true }, done)
    } else {
      execFile('gcloud', args, { timeout: 30_000 }, done)
    }
  })
  if (!token) throw new AIError('missing_key', 'Vertex AI could not get a sign-in token. Run: gcloud auth application-default login')
  cached = { token, expires: Date.now() + 45 * 60_000 }
  return token
}
