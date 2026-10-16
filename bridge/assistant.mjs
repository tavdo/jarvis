import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { redact } from './config.mjs'

/**
 * What JARVIS keeps between conversations: the facts he was told to remember,
 * the reminders he is holding, and the routines the user defined.
 *
 * Each is a small JSON file in ~/.jarvis, owned by this process alone, so it
 * is read once and kept in memory; every change is written straight back.
 * Anything on disk that does not validate is ignored rather than trusted.
 */

const DIR = join(homedir(), '.jarvis')

function load(file, schema) {
  const path = join(DIR, file)
  if (!existsSync(path)) return []
  try {
    const parsed = z.array(schema).safeParse(JSON.parse(readFileSync(path, 'utf8')))
    if (parsed.success) return parsed.data
    console.warn(`[jarvis] ${file} did not validate and was ignored`)
  } catch (err) {
    console.warn(`[jarvis] ${file} could not be read: ${err?.message ?? err}`)
  }
  return []
}

/** Written beside the target and renamed over it, so a crash never leaves half a file. */
function save(file, value) {
  mkdirSync(DIR, { recursive: true })
  const path = join(DIR, file)
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2))
  renameSync(`${path}.tmp`, path)
}

const nextId = (prefix, items) =>
  `${prefix}${items.reduce((max, i) => Math.max(max, Number(i.id.slice(prefix.length)) || 0), 0) + 1}`

/**
 * Passwords, keys and card numbers are never stored, and never handed to the
 * model from the clipboard. Deliberately broad: a false alarm costs one
 * sentence, a stored password costs far more.
 */
export function looksSecret(text) {
  const s = String(text ?? '')
  if (redact(s) !== s) return true
  if (/\b(pass(word|code|wd|phrase)|api[ _-]?key|secret key|access token|auth token|cvv|cvc|iban|seed phrase)\b/i.test(s)) return true
  if (/\bpin\b\D{0,15}\d{3,}/i.test(s)) return true
  if (/\b(?:\d[ -]?){13,19}\b/.test(s)) return true
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s)) return true
  return false
}

/** A single word that reads like a password or a token: mixed classes, no spaces, not a URL or address. */
export function looksLikeCredential(text) {
  const s = String(text ?? '').trim()
  if (!s || /\s/.test(s) || s.length < 8 || s.length > 256) return false
  if (/^(https?:\/\/|www\.|[a-z]:\\|\\\\|\/)/i.test(s)) return false
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s)) return false
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(s)).length
  return classes >= 3 || (classes === 2 && /\d/.test(s) && s.length >= 20)
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export const MEMORY_MAX = 100
const MemoryItem = z.object({ id: z.string(), text: z.string().max(300), at: z.number() })

let memories = null
const memoryList = () => (memories ??= load('memory.json', MemoryItem))

export const memory = {
  list: () => [...memoryList()],

  /** @returns {{ item: z.infer<typeof MemoryItem>, duplicate: boolean }} */
  add(text) {
    const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 300)
    const list = memoryList()
    const same = list.find((m) => m.text.toLowerCase() === clean.toLowerCase())
    if (same) return { item: same, duplicate: true }
    if (list.length >= MEMORY_MAX) throw new Error(`memory is full (${MEMORY_MAX} facts); forget something first`)
    const item = { id: nextId('m', list), text: clean, at: Date.now() }
    list.push(item)
    save('memory.json', list)
    return { item, duplicate: false }
  },

  /** @returns the items that were removed */
  remove(ids) {
    const list = memoryList()
    const gone = list.filter((m) => ids.includes(m.id))
    if (gone.length) {
      memories = list.filter((m) => !ids.includes(m.id))
      save('memory.json', memories)
    }
    return gone
  },
}

// ---------------------------------------------------------------------------
// Reminders, timers and alarms
// ---------------------------------------------------------------------------

export const REMINDER_MAX = 50
const DAY = 86_400_000
const Reminder = z.object({
  id: z.string(),
  kind: z.enum(['reminder', 'timer', 'alarm']),
  text: z.string().max(200),
  due: z.number(),
  repeat: z.enum(['none', 'daily', 'weekdays']),
  created: z.number(),
})

let reminderCache = null
const reminderList = () => (reminderCache ??= load('reminders.json', Reminder))

/** The next time a repeating reminder is due after `now`, keeping its time of day. */
function nextOccurrence(r, now) {
  const d = new Date(r.due)
  while (d.getTime() <= now || (r.repeat === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6))) {
    d.setDate(d.getDate() + 1)
  }
  return d.getTime()
}

/**
 * When something is due, from what the model said. Either a delay in minutes,
 * or a 24-hour clock time with an optional date; a time with no date that has
 * already passed today means tomorrow. Local time throughout.
 */
export function resolveDue({ in_minutes, at, date }, now = Date.now()) {
  if (in_minutes !== undefined) return now + Math.round(in_minutes * 60_000)
  if (!at) throw new Error('give either in_minutes or at')
  const [h, m] = at.split(':').map(Number)
  const d = date ? new Date(`${date}T00:00:00`) : new Date(now)
  if (Number.isNaN(d.getTime())) throw new Error('that date does not exist')
  d.setHours(h, m, 0, 0)
  if (d.getTime() <= now) {
    if (date) throw new Error('that time has already passed')
    d.setDate(d.getDate() + 1)
  }
  if (d.getTime() - now > 366 * DAY) throw new Error('that is more than a year away')
  return d.getTime()
}

export const reminders = {
  list: () => [...reminderList()].sort((a, b) => a.due - b.due),

  add({ kind, text, due, repeat }) {
    const list = reminderList()
    if (list.length >= REMINDER_MAX) throw new Error(`there are already ${REMINDER_MAX} reminders; cancel one first`)
    const item = { id: nextId('r', list), kind, text: String(text).trim().slice(0, 200), due, repeat, created: Date.now() }
    list.push(item)
    save('reminders.json', list)
    return item
  },

  remove(id) {
    const list = reminderList()
    const gone = list.find((r) => r.id === id)
    if (gone) {
      reminderCache = list.filter((r) => r.id !== id)
      save('reminders.json', reminderCache)
    }
    return gone ?? null
  },
}

/**
 * Check every second for anything due. A reminder that fell due while the
 * bridge was not running fires as soon as it starts again, marked late.
 * Repeating ones roll forward to their next time; the rest are removed.
 *
 * @param {(r: z.infer<typeof Reminder>, lateMs: number) => void} onFire
 */
export function startReminderClock(onFire) {
  const tick = () => {
    const now = Date.now()
    const list = reminderList()
    const due = list.filter((r) => r.due <= now)
    if (!due.length) return
    for (const r of due) {
      try {
        onFire(r, now - r.due)
      } catch (err) {
        console.error('[jarvis] reminder failed to fire:', err)
      }
    }
    reminderCache = list.flatMap((r) =>
      r.due > now ? [r] : r.repeat === 'none' ? [] : [{ ...r, due: nextOccurrence(r, now) }],
    )
    save('reminders.json', reminderCache)
  }
  tick()
  setInterval(tick, 1000).unref()
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

export const ROUTINE_MAX = 20
export const Routine = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'a routine needs a name')
    .max(40)
    .regex(/^[^\r\n]*$/, 'one line only'),
  steps: z.string().trim().min(1, 'a routine needs at least one step').max(800),
})
export const Routines = z
  .array(Routine)
  .max(ROUTINE_MAX)
  .refine((list) => new Set(list.map((r) => r.name.toLowerCase())).size === list.length, 'two routines share a name')

let routineCache = null

export const routines = {
  list: () => [...(routineCache ??= load('routines.json', Routine))],

  replace(list) {
    const parsed = Routines.safeParse(list)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    routineCache = parsed.data
    save('routines.json', routineCache)
    return routineCache
  },

  find(name) {
    const want = String(name).trim().toLowerCase()
    return this.list().find((r) => r.name.toLowerCase() === want) ?? null
  },
}
