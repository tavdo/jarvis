import { create } from 'zustand'
import { BRIDGE_HTTP_URL } from '../config'

/**
 * The passcode lock, page side (the bridge decides — see bridge/passcode.mjs).
 *
 * The page never knows the code. It sends the digits once, and gets back a
 * session token that lives in this module's memory only: not localStorage, so
 * closing or reloading the window locks JARVIS again. The token goes with every
 * request the bridge guards (settings, memory) and once per socket (bridge.ts),
 * and without it the bridge will not run a turn.
 */

export type LockMode = 'unset' | 'on' | 'off'
export type LockStatus = {
  mode: LockMode
  /** How long the keypad is locked out after too many wrong codes. */
  waitMs: number
  failures: number
  attemptsLeft: number
  /** Recent attempts, newest last. */
  log: { at: number; ok: boolean }[]
}
export type LockReply = LockStatus & { ok: boolean; error?: string; token?: string }

let session: string | null = null
const listeners = new Set<(token: string | null) => void>()

export const sessionToken = () => session
export const sessionHeaders = (): Record<string, string> => (session ? { 'x-jarvis-session': session } : {})

/** bridge.ts hands the token to the socket whenever it changes. */
export function onSession(fn: (token: string | null) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function setSession(token: string | null) {
  session = token
  for (const fn of listeners) fn(token)
}

export const useLock = create<{ locked: boolean }>(() => ({ locked: false }))
export const isLocked = () => useLock.getState().locked

export async function lockStatus(): Promise<LockStatus> {
  const res = await fetch(`${BRIDGE_HTTP_URL}/passcode`, { cache: 'no-store', signal: AbortSignal.timeout(4000) })
  if (!res.ok) throw new Error(`The bridge answered ${res.status}.`)
  return (await res.json()) as LockStatus
}

/** Any lock operation. A token in the reply becomes the session. */
export async function passcode(
  op: 'unlock' | 'create' | 'change' | 'remove' | 'lock',
  body: { code?: string; current?: string } = {},
): Promise<LockReply> {
  const res = await fetch(`${BRIDGE_HTTP_URL}/passcode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeaders() },
    body: JSON.stringify({ op, ...body }),
    signal: AbortSignal.timeout(10_000),
  })
  const reply = (await res.json().catch(() => ({ ok: false, error: `The bridge answered ${res.status}.` }))) as LockReply
  if (reply.ok && reply.token) setSession(reply.token)
  return reply
}

let release: (() => void) | null = null

/** The lock screen got a session: let the boot carry on. */
export function granted() {
  useLock.setState({ locked: false })
  release?.()
  release = null
}

/**
 * Resolves once the page holds a session. With the lock switched off that is
 * immediate; otherwise the lock screen goes up until the right code is entered.
 */
export function requireUnlock(): Promise<void> {
  if (session) return Promise.resolve()
  // Up at once, so the deck never shows for the moment the status takes. The
  // screen itself lets you straight through when the lock is switched off.
  useLock.setState({ locked: true })
  return new Promise((resolve) => {
    release = resolve
  })
}

/** Lock now (Settings → LOCK NOW). Resolves when it is unlocked again. */
export async function lockNow(): Promise<void> {
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  useLock.setState({ locked: true })
  await passcode('lock').catch(() => {})
  setSession(null)
  return wait
}
