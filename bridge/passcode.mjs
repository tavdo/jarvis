import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'

/**
 * The passcode lock.
 *
 * The page shows the keypad; this decides. The code itself is never stored —
 * only a salted scrypt hash in ~/.jarvis/passcode.json — and never reaches the
 * page or the model. A correct code earns a session: a random token the page
 * keeps in memory only, so closing or reloading the window locks JARVIS again.
 * Until a page holds a live session the bridge will not run a turn, change a
 * setting or show what he remembers (see server.mjs).
 *
 * Sessions are kept as hashes in the same file so that the bridge restarting
 * itself after a settings change does not lock out the window that asked for it.
 *
 * Six digits is a million codes, which is only worth anything with a limit on
 * guessing: five wrong in a row locks the keypad for 30 seconds, and every
 * further miss doubles that, up to 15 minutes. The count survives restarts.
 */

const DIR = join(homedir(), '.jarvis')
const FILE = join(DIR, 'passcode.json')

export const CODE = /^\d{6}$/
const FREE_TRIES = 5
const FIRST_WAIT_MS = 30_000
const MAX_WAIT_MS = 15 * 60_000
const SESSION_TTL_MS = 24 * 3600_000
const MAX_SESSIONS = 8
const LOG_SIZE = 12

const scryptAsync = promisify(scrypt)

const State = z.object({
  /** unset: never configured (first start asks for one). on: required. off: switched off in Settings. */
  mode: z.enum(['unset', 'on', 'off']),
  salt: z.string().optional(),
  hash: z.string().optional(),
  failures: z.number().int().min(0).default(0),
  waitUntil: z.number().default(0),
  sessions: z.array(z.object({ hash: z.string(), at: z.number() })).default([]),
  log: z.array(z.object({ at: z.number(), ok: z.boolean() })).default([]),
})

function load() {
  if (!existsSync(FILE)) return State.parse({ mode: 'unset' })
  try {
    const parsed = State.safeParse(JSON.parse(readFileSync(FILE, 'utf8')))
    if (parsed.success && (parsed.data.mode !== 'on' || (parsed.data.salt && parsed.data.hash))) return parsed.data
  } catch {
    /* unreadable */
  }
  // A damaged file must not become an open door: keep the lock on with no
  // code that can match, and say how to reset it.
  console.warn(`[jarvis] ${FILE} is damaged — delete it to set a new passcode`)
  return State.parse({ mode: 'on', salt: 'x', hash: 'x' })
}

let state = load()

function save() {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(`${FILE}.tmp`, JSON.stringify(state, null, 2))
  renameSync(`${FILE}.tmp`, FILE)
}

async function derive(code, salt) {
  return /** @type {Buffer} */ (await scryptAsync(code, Buffer.from(salt, 'hex'), 32))
}

const tokenHash = (token) => createHash('sha256').update(String(token)).digest('hex')

function newSession() {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  state.sessions = [
    ...state.sessions.filter((s) => now - s.at < SESSION_TTL_MS),
    { hash: tokenHash(token), at: now },
  ].slice(-MAX_SESSIONS)
  save()
  return token
}

function remember(ok) {
  state.log = [...state.log, { at: Date.now(), ok }].slice(-LOG_SIZE)
}

/** What the lock screen may know: never the hash, never a token. */
export function status() {
  return {
    mode: state.mode,
    waitMs: Math.max(0, state.waitUntil - Date.now()),
    failures: state.failures,
    attemptsLeft: Math.max(0, FREE_TRIES - state.failures),
    log: state.log,
  }
}

/** Is this token a live session? Touching it keeps it alive. */
export function sessionValid(token) {
  if (typeof token !== 'string' || token.length !== 64) return false
  const h = tokenHash(token)
  const now = Date.now()
  const s = state.sessions.find((x) => x.hash === h && now - x.at < SESSION_TTL_MS)
  if (!s) return false
  // Written back at most once a minute — this runs on every request.
  if (now - s.at > 60_000) {
    s.at = now
    save()
  }
  return true
}

export function endSession(token) {
  const h = tokenHash(token)
  state.sessions = state.sessions.filter((s) => s.hash !== h)
  save()
}

class PasscodeError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
export { PasscodeError }

async function matches(code) {
  if (!state.salt || !state.hash || !CODE.test(String(code ?? ''))) return false
  const want = Buffer.from(state.hash, 'hex')
  const got = await derive(String(code), state.salt)
  return want.length === got.length && timingSafeEqual(want, got)
}

/**
 * Check a code, counting misses. Throws a PasscodeError with the wait on a
 * miss or while locked out; returns a session token on success.
 */
async function check(code) {
  const wait = state.waitUntil - Date.now()
  if (wait > 0) throw new PasscodeError(`Locked. Try again in ${Math.ceil(wait / 1000)} s.`, 429)
  if (await matches(code)) {
    state.failures = 0
    state.waitUntil = 0
    remember(true)
    return true
  }
  state.failures++
  if (state.failures >= FREE_TRIES) {
    state.waitUntil = Date.now() + Math.min(MAX_WAIT_MS, FIRST_WAIT_MS * 2 ** (state.failures - FREE_TRIES))
  }
  remember(false)
  save()
  throw new PasscodeError('Access denied.', 401)
}

async function setCode(code) {
  if (!CODE.test(String(code ?? ''))) throw new PasscodeError('The passcode must be exactly six digits.')
  const salt = randomBytes(16).toString('hex')
  state.salt = salt
  state.hash = (await derive(String(code), salt)).toString('hex')
  state.mode = 'on'
  state.failures = 0
  state.waitUntil = 0
}

/**
 * One operation at a time. Without this a thousand guesses sent at once would
 * all be checked before the first miss had been counted, and the lockout would
 * never get a say.
 */
let queue = Promise.resolve()

/**
 * Every change to the lock, by name. `session` is the caller's token, if any;
 * changing or removing a code needs both a session and the current code.
 */
export function act(op, body, session) {
  const run = queue.then(() => perform(op, body ?? {}, session))
  queue = run.catch(() => {})
  return run
}

async function perform(op, body, session) {
  const live = sessionValid(session)
  switch (op) {
    case 'unlock': {
      if (state.mode === 'unset') throw new PasscodeError('No passcode has been set yet.', 409)
      if (state.mode === 'off') return { token: newSession() }
      await check(body.code)
      return { token: newSession() }
    }
    case 'create': {
      // First start only. Afterwards a code can only be changed by someone who knows it.
      if (state.mode !== 'unset') throw new PasscodeError('A passcode is already set.', 409)
      await setCode(body.code)
      remember(true)
      return { token: newSession() }
    }
    case 'change': {
      if (!live) throw new PasscodeError('Unlock first.', 401)
      if (state.mode === 'on') await check(body.current)
      await setCode(body.code)
      save()
      return {}
    }
    case 'remove': {
      if (!live) throw new PasscodeError('Unlock first.', 401)
      if (state.mode === 'on') await check(body.current)
      state.mode = 'off'
      state.salt = undefined
      state.hash = undefined
      save()
      return {}
    }
    case 'lock': {
      if (typeof session === 'string') endSession(session)
      return {}
    }
    default:
      throw new PasscodeError('Unknown operation.')
  }
}
