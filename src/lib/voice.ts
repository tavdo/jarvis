import { BRIDGE_HTTP_URL } from '../config'
import { getMic } from './audio'
import { speakingNow, speakingSince } from './tts'
import { startVad, type Vad } from './vad'
import { caps } from './capabilities'
import { prefsNow } from './prefs'

/**
 * The voice loop.
 *
 * One recogniser, running for the life of the page. It is never torn down for
 * a turn, and that single fact is most of what separates this from a kiosk:
 * the microphone is still open while JARVIS is talking, so you can cut him off
 * the way you would cut off a person.
 *
 * The obvious design — one recogniser hunting for the wake word, a second one
 * capturing the command, stopping the first to start the second because the
 * browser only hands out one at a time — is what this replaces. It works, but
 * nothing is listening during an answer, so barge-in is impossible, and every
 * restart leaves a quarter-second of deafness that eats whole wake words.
 *
 * Keeping the mic open costs one thing: JARVIS hears himself through the
 * speakers. That is handled here in text rather than in acoustics — see
 * `isEcho` — because the browser gives SpeechRecognition its own capture and
 * won't let us put a canceller in front of it.
 */

export type VoiceMode =
  /** Powered down. Only his name matters. */
  | 'wake'
  /** He is expecting you to speak. Everything is a command. */
  | 'command'
  /** He is thinking or talking. Anything you say is an interruption. */
  | 'guard'
  /** Something is playing that must not be transcribed at all. */
  | 'deaf'

export type VoiceHandlers = {
  /** Read fresh on every result, so the app never has to re-subscribe. */
  mode: () => VoiceMode
  /** Fired on his name, from a partial — waiting for endpointing feels slow.
   *  `trailing` is whatever followed it, so "Jarvis, what's the weather" is
   *  one breath rather than two turns. */
  onWake: (trailing: string) => void
  /** The user has genuinely started talking. This is the barge-in trigger. */
  onSpeechStart: () => void
  /** Live transcript, for the caption under the reactor. */
  onPartial: (text: string) => void
  /** A complete, endpointed utterance. */
  onUtterance: (text: string) => void
  /** A confirmation is waiting on a spoken yes or no. Speech is the answer
   *  then, so it is never filtered down to stop words. */
  answering: () => boolean
  /** The recogniser is unusable. Distinct from the user saying nothing. */
  onError: (message: string) => void
}

export type Voice = {
  stop: () => void
  /** True while a recogniser is actually running. */
  live: () => boolean
}

// ---------------------------------------------------------------------------
// Endpointing
// ---------------------------------------------------------------------------

/** One utterance often produces several partials containing his name. */
const WAKE_DEBOUNCE = 1500

/**
 * A letter or digit in any script. JavaScript's \b only knows A–Z, so it
 * never finds the edge of a Georgian word; these lookarounds do.
 */
const LETTER = '[\\p{L}\\p{N}_]'

/** His name as a Georgian recogniser writes it: ჯარვის, ჯარვისი, ჯარვისო, ჯერვის. */
export const NAME_KA = 'ჯ[აე]რვის[იო]?'

/**
 * His name, and the only wake phrase.
 *
 * The optional prefix is genuinely optional: addressing him by name alone is
 * correct, and during an answer "Jarvis" on its own is the natural way to cut
 * in. The negative lookahead keeps possessives ("Jarvis's job") from waking him.
 *
 * The alternates are not padding. "Jarvis" is not in a general dictation
 * model's high-frequency vocabulary, and Chrome routinely returns Travis,
 * Jervis, Jarvys or Java's for a perfectly clear utterance — every one of which
 * used to be silently discarded, so the wake word "just didn't work" with no
 * indication why. Better a rare false wake than a name that does not answer.
 */
const WAKE = new RegExp(
  `(?<!${LETTER})(?:(?:hey|hi|ok|okay|yo|ჰეი)\\s*)?(?:jarvis|jarvys|jervis|jarvis's|travis|jarviss|java's|jarv|${NAME_KA})(?!${LETTER})(?!'s)`,
  'iu',
)

/** His name and its usual mishearings, as one alternation. */
const NAME_WORDS = `jarvis|jarvys|jervis|travis|jarviss|java's|jarv|${NAME_KA}`

/**
 * What cuts him off while he is talking, when only words may (the default).
 *
 * Narrower than OVERRIDE on purpose. "No" and "wait" turn up in every
 * conversation on a television, and the point of the setting is that the
 * television cannot stop him: only "stop", its few plain synonyms, or his name.
 *
 * A lone "გაჩერდი" loses or changes its first sound more often than not —
 * "აჩერდი", "მაჩერდი" — because the recorder starts a moment after the word
 * does, so it is matched on "ჩერდი". In English mode, where the transcriber
 * guesses the language per clip, it comes back as "Açerdi", "gacherdi" or
 * "Acher de" — and sometimes as something no pattern could catch, which is
 * why "stop" and his name are the reliable words there.
 */
const HALT = new RegExp(
  `(?<![\\p{L}\\p{N}_-])(?:stop|enough|cancel|quiet|shut up|სტოპ|[ა-ჰ]{0,2}ჩერდი(?:თ)?|კმარა|შეწყვიტე|გაჩუმდი|გააუქმე|` +
    `(?:g?a)?[cçč]h?er ?d[ei]|kmara|${NAME_WORDS})(?!${LETTER})`,
  'iu',
)
const HALT_ALL = new RegExp(HALT.source, 'giu')

/** The stop-words-only rule is on, and nothing is waiting on a yes or no. */
const wordsOnly = (h: VoiceHandlers) => prefsNow().stopWordsOnly && !h.answering()

/**
 * Scribe describes the sounds it hears as well as the words: "(music)",
 * "[applause]", "(TV playing)". Those are the room, not the user, and taken as
 * speech they were the "questions" he answered when nobody had said anything.
 */
function wordsIn(text: string): string {
  return text
    .replace(/\([^)]*\)|\[[^\]]*\]|\*[^*]*\*|[♪♫]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A hum or a breath transcribed — never a request on its own. */
const FILLER = /^(?:u+h+|u+m+|h?m+|hm+|a+h+|o+h+|e+h+|e+r+)[\s.,!?…-]*$/i

// ---------------------------------------------------------------------------
// Only the user's voice
// ---------------------------------------------------------------------------

/**
 * How loud the user is, learned from the segments that carried his name.
 *
 * There is no voiceprint here — a browser has nothing that can tell two people
 * apart reliably — but distance does most of the same work. The user is the
 * one sitting at the microphone; a television, music or the people in the next
 * room arrive many decibels quieter. Every time his name is heard the level of
 * that segment is recorded, and anything far below the user's usual level is
 * dropped before it is even sent for transcription.
 *
 * Only name-bearing segments teach it. Those are the ones that are certainly
 * the user; learning from every accepted command would let a loud television
 * drag the profile down until it let itself in.
 */
const PROFILE_KEY = 'jarvis.voiceLevel'
const PROFILE_SIZE = 12
/** Below this share of the user's level a segment is someone else. Lenient
 *  for the wake word, so standing up and calling him from across the room still works. */
const FAINT: Record<'wake' | 'command' | 'guard', number> = { wake: 0.2, command: 0.35, guard: 0.35 }

let profile: number[] = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '[]')
    return Array.isArray(saved)
      ? saved.filter((n) => typeof n === 'number' && n > 0 && n < 1).slice(-PROFILE_SIZE)
      : []
  } catch {
    return []
  }
})()

/** The median, so one shout or one mumble does not move it. 0 = not learned yet. */
function yourLevel(): number {
  if (!profile.length) return 0
  const sorted = [...profile].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function learnVoice(level: number) {
  if (!prefsNow().voiceFocus || !(level > 0)) return
  profile = [...profile, level].slice(-PROFILE_SIZE)
  diag.voiceLevel = yourLevel()
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch {
    /* storage blocked — it still works for this session */
  }
}

function tooFaint(level: number, mode: VoiceMode): boolean {
  if (!prefsNow().voiceFocus || mode === 'deaf') return false
  const mine = yourLevel()
  return mine > 0 && level < mine * FAINT[mode]
}

/** Everything after the wake phrase, which is usually the actual command. */
function afterWake(text: string): string {
  const m = WAKE.exec(text)
  if (!m) return ''
  return text
    .slice(m.index + m[0].length)
    .replace(/^[\s,.:;!?-]+/, '')
    .trim()
}

// ---------------------------------------------------------------------------
// Assembling one utterance out of several segments
// ---------------------------------------------------------------------------

/**
 * Why this exists.
 *
 * The voice-activity detector is an energy gate, and energy is a fact about the
 * room rather than about the sentence. It ends a segment after a fixed quiet
 * gap, so "what's the weather in — " *pause* " — London" is two segments, two
 * transcripts and, before this, two turns: the first one asking the model a
 * truncated question, the second arriving as a bare noun with no question left
 * to attach it to. People pause. They pause to think of the word, to look at
 * something, mid-list, before the important part. An assistant that treats the
 * first gap as the end of the thought is one you have to talk to carefully, and
 * having to talk carefully is the whole failure.
 *
 * So the segment is no longer the turn. Transcripts accumulate here, and the
 * turn fires only when the text looks finished AND the room has gone quiet.
 *
 * Crucially this costs nothing in the common case. A complete sentence with no
 * one speaking fires immediately — `holdFor` returns 0 — so the latency of an
 * ordinary question is exactly what it was. The waiting only happens when there
 * is a reason to wait.
 */

/**
 * Ending on one of these means the sentence is not over, whatever the silence
 * says. Function words only: they are closed-class, so the list is complete in
 * a way a content-word list could never be, and none of them is a plausible
 * last word of a real request.
 */
const CONTINUES =
  /\b(and|or|but|so|because|since|if|when|while|that|which|who|whose|to|of|in|on|at|by|for|with|from|about|into|onto|over|under|between|through|the|a|an|my|your|his|her|its|our|their|is|are|was|were|be|been|do|does|did|have|has|had|can|could|would|should|will|shall|might|must|like|than|then|as|very|really|just|some|any|all|both|either|neither)$/i

/** Trailing punctuation a transcriber emits mid-thought. */
const TRAILS = /[,;:–—-]$/

/**
 * A barge-in this soon after he starts a sentence is him, not you.
 *
 * Echo cancellation and the raised guard threshold stop most of his playback
 * reaching the detector, but the attack of the very first syllable is the
 * loudest, least-cancelled thing in the whole answer — it arrives before the
 * canceller has adapted to it. Without this, a long answer could interrupt
 * itself on its own first word, which reads as JARVIS refusing to speak.
 *
 * Kept short deliberately. This is the one window where a genuine interruption
 * is also least likely: the user has not yet heard enough to want to stop him.
 */
const SELF_GUARD_MS = 350

/**
 * A quiet gap this long with a finished-looking sentence ends the turn.
 *
 * Small on purpose: by the time a transcript reaches the assembler the detector
 * has already sat through SILENCE_MS of quiet and the transcriber has taken its
 * own few hundred milliseconds, so roughly a second of real silence has passed
 * already. All this window has to catch is someone drawing breath to add one
 * more clause. Making it generous here is what would make every ordinary
 * question feel slow.
 */
const SETTLE_MS = 250
/** ...and this long when the sentence is plainly unfinished. */
const CONTINUE_MS = 1600
/**
 * Nothing is held longer than this in total. A ceiling rather than a timer:
 * without it, someone who ends every clause on "and" could hold a turn open
 * for ever, and the assistant would look like it had stopped listening.
 */
const MAX_HOLD_MS = 6000

/**
 * How long to keep waiting, given what has been said so far.
 * 0 means "this is a complete thought, send it now".
 */
function holdFor(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return CONTINUE_MS
  // An explicit terminator is the speaker telling us they are done.
  if (/[.!?]$/.test(text)) return 0
  if (TRAILS.test(text.trim())) return CONTINUE_MS
  if (CONTINUES.test(words[words.length - 1])) return CONTINUE_MS
  // One or two words is usually the start of something, not the whole of it —
  // except for the short commands that genuinely are complete.
  if (words.length <= 2 && !OVERRIDE.test(text)) return CONTINUE_MS
  return SETTLE_MS
}

type Assembler = {
  /** Add a transcript. `active` is true if the user is audibly still going. */
  feed: (text: string, active: boolean) => void
  /** Send whatever is held right now, if anything. */
  flush: () => void
  /** Throw away whatever is held — used when he stands down. */
  cancel: () => void
  held: () => string
}

function makeAssembler(h: {
  emit: (text: string) => void
  partial: (text: string) => void
}): Assembler {
  let held = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  let firstAt = 0

  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const fire = () => {
    clear()
    const text = held.trim()
    held = ''
    firstAt = 0
    if (text) h.emit(text)
  }

  return {
    feed(text, active) {
      if (!text.trim()) return
      held = `${held} ${text}`.replace(/\s+/g, ' ').trim()
      if (!firstAt) firstAt = Date.now()
      // The caption shows the whole thought as it assembles, not just the
      // fragment that happened to arrive last.
      h.partial(held)
      diag.holding = held
      clear()

      // Already talking again. Decide nothing now — the next transcript is
      // part of this same sentence and will bring more of it.
      if (active) {
        timer = setTimeout(fire, MAX_HOLD_MS)
        return
      }

      const wait = Math.min(
        holdFor(held),
        Math.max(0, MAX_HOLD_MS - (Date.now() - firstAt)),
      )
      diag.waitedMs = wait
      if (wait === 0) {
        fire()
        return
      }
      timer = setTimeout(fire, wait)
    },
    flush: fire,
    cancel() {
      clear()
      held = ''
      firstAt = 0
      diag.holding = ''
    },
    held: () => held,
  }
}

// ---------------------------------------------------------------------------
// Hearing himself
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()

const NUMBER_WORDS = new Set(
  ('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen ' +
    'seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand ' +
    'million billion point half quarter').split(' '),
)
const UNITS: Record<string, string> = {
  gigabyte: 'gb', gigabytes: 'gb', gig: 'gb', gigs: 'gb',
  megabyte: 'mb', megabytes: 'mb', terabyte: 'tb', terabytes: 'tb',
  kilobyte: 'kb', kilobytes: 'kb', percent: 'pct', per: 'pct', cent: 'pct',
  degrees: 'deg', degree: 'deg', celsius: 'c', kilometres: 'km', kilometers: 'km',
}

/**
 * One spelling per word for echo matching. The recogniser writes what he says
 * as "sixteen gigabytes" back as "16 GB", so every number becomes '#' and units
 * their abbreviation — otherwise each figure in an answer reads as the user
 * talking over him.
 */
function canon(word: string): string {
  if (/^\d+$/.test(word) || NUMBER_WORDS.has(word)) return '#'
  return UNITS[word] ?? word
}

const wordsOf = (s: string) => norm(s).split(' ').filter(Boolean).map(canon)

/**
 * Short words that must always cut through, even when they collide with what
 * he happens to be saying. Suppressing "stop" because he just said "stop"
 * would be the single most infuriating failure this file could have.
 */
const OVERRIDE = new RegExp(
  `(?<!${LETTER})(?:stop|wait|jarvis|cancel|enough|quiet|hold on|shut up|never ?mind|forget it|no|` +
    `გაჩერდი|მოიცადე|კმარა|შეწყვიტე|გაჩუმდი|არა|სტოპ|${NAME_KA})(?!${LETTER})`,
  'iu',
)

/**
 * Words too common to be evidence of anything.
 *
 * This set is the difference between a usable filter and an infuriating one.
 * "What about the second one?" is a perfectly ordinary follow-up, and every
 * word in it is likely to appear somewhere in the answer it follows — so a
 * naive bag-of-words match suppresses the user's real question as an echo.
 * Only distinctive words count as proof he is hearing himself.
 */
const STOP = new Set(
  ('a an the and or but so of to in on at by for with from is are was were be ' +
    'it its this that these those i you he she we they me him her them my your ' +
    'our their what which who how why when where do does did can could would ' +
    'should will shall not no yes if then than as about into over under out up ' +
    'down one two three first second third now here there just very really got ' +
    'get have has had say said tell me okay ok well right ' +
    'და თუ რომ არ ეს ის ეგ მე შენ ჩვენ თქვენ რა რას როგორ რატომ როდის სად ვინ კი ხომ ' +
    'უკვე ახლა აქ იქ ან მაგრამ არის იყო ვარ ხარ ჩემი შენი ერთი ორი სამი ძალიან ' +
    'კარგი დიახ ჰო ხო ბატონო').split(' '),
)

/**
 * Is this the microphone hearing the speakers?
 *
 * Compared as bags of words rather than by string distance: the recogniser
 * mangles its own playback badly enough that a substring match rarely holds,
 * but the *words* survive.
 */
function isEcho(heard: string, spoken: string): boolean {
  if (!spoken) return false
  if (overrides(heard, spoken)) return false

  const all = wordsOf(heard)
  if (!all.length) return true

  const mine = new Set(wordsOf(spoken))
  const content = all.filter((w) => !STOP.has(w))

  // Nothing distinctive was said at all, so there is no strong evidence either
  // way. Demand a total match before discarding it — the cost of dropping a
  // real question is much higher than the cost of one stray echo getting in.
  if (content.length < 2) {
    if (all.length < 2) return false
    return all.every((w) => saidBy(w, mine))
  }

  let hits = 0
  for (const w of content) if (saidBy(w, mine)) hits++
  return hits / content.length >= 0.6
}

/**
 * How many of these words he is not saying. Used while he talks: the browser
 * recogniser hears every word of his through the speakers, a long sentence
 * comes back as dozens of fragments, and one misheard word in a two-word
 * fragment used to be enough to cut him off. A real interruption brings at
 * least two words of its own; "stop", "wait" and his name need none. Function
 * words do not count: the recogniser splits his "about" into "a bad".
 */
function foreignWords(heard: string, spoken: string): number {
  const mine = new Set(wordsOf(spoken))
  return wordsOf(heard).filter((w) => !STOP.has(w) && !saidBy(w, mine)).length
}

const OVERRIDE_ALL = new RegExp(OVERRIDE.source, 'giu')

/**
 * An override word from the user, rather than one of his own words coming
 * back through the speakers.
 *
 * A word he is not saying always cuts through, at any length. A word he *is*
 * saying only counts when it arrives bare — "stop", "no, wait" — because that
 * is the stop button; arriving with the rest of his sentence ("there is no
 * need"), it is his echo, and treating it as a command cut long answers off
 * mid-sentence.
 */
function overrides(heard: string, spoken: string, one = OVERRIDE, all = OVERRIDE_ALL): boolean {
  if (!one.test(heard)) return false
  const mine = ` ${norm(spoken)} `
  const found = [...heard.matchAll(all)].map((m) => norm(m[0]))
  if (found.some((w) => !mine.includes(` ${w} `))) return true
  const rest = norm(heard.replace(all, ' ')).split(' ').filter(Boolean)
  return rest.length === 0
}

/** "Stop" or his name from the user — the same echo rule as `overrides`. */
const halts = (heard: string, spoken: string) => overrides(heard, spoken, HALT, HALT_ALL)

/** Edit distance within `max`, bailing out as soon as it can't be. */
function near(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, cur[j])
    }
    if (best > max) return false
    prev = cur
  }
  return prev[b.length] <= max
}

/**
 * Is this one of his words? The recogniser mangles its own playback — "bytes"
 * comes back as "bites", "gigabytes" as "giga" — and on a long sentence one
 * mangled word was enough to read the echo as an interruption. A near miss
 * on a word of four letters or more counts.
 */
function saidBy(word: string, mine: Set<string>): boolean {
  if (mine.has(word)) return true
  if (word.length < 4) return false
  const max = word.length >= 7 ? 2 : 1
  for (const s of mine) {
    if (s.length >= 4 && (s.startsWith(word) || s.endsWith(word) || near(word, s, max))) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * Live state of the voice loop, published on `window.__voice`.
 *
 * When someone says the wake word and nothing happens there are only a handful
 * of possible causes — the recogniser never started, it started and died, it is
 * running but hearing silence, or it is hearing you and transcribing the name
 * as something else. From outside the page those are indistinguishable, which
 * makes the failure impossible to report and impossible to fix. This tells them
 * apart in one glance.
 */
export const diag = {
  /** Which input engine is running: 'elevenlabs' (VAD+Scribe) or 'browser'. */
  engine: 'browser',
  /** Whether the microphone pipeline is live. */
  running: false,
  /** Speech segments captured since load. */
  sessions: 0,
  /** The most recent transcript, whatever the mode. */
  heard: '',
  /** What the browser recogniser has right now, before it is final. */
  partial: '',
  heardAt: 0,
  /** Last failure — a transcription error, or a capture error. */
  lastError: '',
  /** Times the wake word matched. */
  wakes: 0,
  /** Current mode, as the app last reported it. */
  mode: '',
  /** Why the last transcript was ignored — '' when it was accepted. */
  dropped: '',
  /** Transcripts accepted and passed to the app. */
  accepted: 0,
  /** Text assembled but not yet sent, because the thought looks unfinished. */
  holding: '',
  /** How long the assembler decided to wait before sending, in ms. */
  waitedMs: 0,
  /** Barge-ins suppressed because he had only just started the sentence. */
  selfGuarded: 0,
  /** What was heard when the last barge-in cut him off, and what he was saying. */
  bargedOn: '',
  bargedOver: '',
  /** Transcription failures (network, or the bridge speech proxy). */
  restarts: 0,
  /** Milliseconds the last transcription round-trip took. */
  idleMs: 0,
  /** The user's learned speaking level (0 = not learned yet), and the last segment's. */
  voiceLevel: yourLevel(),
  segmentLevel: 0,
  /** Segments dropped as too quiet to be the user. */
  faint: 0,
  /** Speech ignored while he talked, because it was not "stop" or his name. */
  ignored: 0,
}

/** Record why a transcript went nowhere. Silence always has a reason; this is
 *  the difference between debugging it and speculating about it. */
function drop(why: string) {
  diag.dropped = why
}

if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__voice = diag
}

/**
 * Pick the voice engine and start it.
 *
 * Two engines, chosen by what the bridge reported at boot (see capabilities.ts):
 *   - ElevenLabs available -> local voice-activity detection for instant
 *     barge-in, and ElevenLabs Scribe for the words. The reliable path.
 *   - nothing configured -> the browser's own SpeechRecognition, so a student
 *     with no keys still has a working assistant. Less robust, but free and
 *     zero-setup, and guarded by a heartbeat so its silent death is recovered.
 *
 * The microphone is opened once here so a denied permission is reported loudly
 * rather than surfacing later as an unexplained deafness, whichever engine runs.
 */
export async function startVoice(h: VoiceHandlers): Promise<Voice> {
  try {
    await getMic()
  } catch (err) {
    diag.lastError = 'mic'
    h.onError(
      err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone access denied — voice input is unavailable.'
        : 'No microphone available.',
    )
    return { stop: () => {}, live: () => false }
  }
  diag.engine = caps().stt ? 'elevenlabs' : 'browser'
  return caps().stt ? startElevenVoice(h) : startBrowserVoice(h)
}

/** One captured stretch of speech, waiting for the transcriber. */
type Segment = {
  blob: Blob
  /** Captured while he talked under the stop-words-only rule. */
  guarded: boolean
  loudness: number
}

/** VAD + ElevenLabs Scribe. */
async function startElevenVoice(h: VoiceHandlers): Promise<Voice> {
  let lastWake = 0
  let vad: Vad | null = null

  /**
   * Segments waiting for the transcriber, oldest first.
   *
   * This was a boolean — `if (transcribing) return` — and that single line was
   * the worst bug in the pause story. Segments arrive faster than Scribe
   * answers whenever someone speaks in bursts, which is exactly what pausing
   * mid-sentence looks like, so the second half of the thought was not merely
   * mis-timed, it was silently discarded. Queue instead: nothing a person says
   * out loud gets thrown away because the network was busy.
   *
   * Order is preserved because the drain is single-flight, which matters —
   * "London" arriving before "what's the weather in" is worse than either.
   */
  const pendingAudio: Segment[] = []
  let draining = false
  /**
   * The segment being captured started while he was talking, under the
   * stop-words-only rule. Decided at the start rather than when the words come
   * back: he has often finished his sentence by then, and a television heard
   * over him must not turn into a question the moment he stops.
   */
  let capturingGuarded = false
  let capturingMode: VoiceMode = 'wake'

  /**
   * Transcripts become turns here rather than one-per-segment.
   * See makeAssembler for why.
   */
  const assemble = makeAssembler({
    emit: (text) => {
      diag.dropped = ''
      diag.accepted++
      diag.holding = ''
      h.onUtterance(text)
    },
    partial: (text) => h.onPartial(text),
  })

  /**
   * Send one captured segment to the bridge and act on the words.
   *
   * The mode is re-read here, not at capture time, because a barge-in flips the
   * machine from 'guard' to 'listening' between the segment starting and its
   * transcript arriving — and the transcript belongs to the mode the user is in
   * now, not the one they interrupted.
   */
  const transcribe = async ({ blob, guarded, loudness }: Segment) => {
    const mode = h.mode()
    if (mode === 'deaf') return
    const t0 = performance.now()
    try {
      const res = await fetch(`${BRIDGE_HTTP_URL}/stt`, {
        method: 'POST',
        headers: { 'content-type': blob.type || 'audio/webm' },
        body: blob,
      })
      diag.idleMs = Math.round(performance.now() - t0)
      if (!res.ok) {
        diag.restarts++
        diag.lastError = `stt ${res.status}`
        drop(`transcription failed (${res.status})`)
        return
      }
      const { text } = (await res.json()) as { text?: string }
      const raw = (text ?? '').trim()
      const said = wordsIn(raw)
      diag.lastError = ''

      if (!said) {
        drop(raw ? `only background sound — ${raw.slice(0, 40)}` : 'nothing intelligible in the segment')
        return
      }
      if (FILLER.test(said)) {
        drop(`just a "${said}"`)
        return
      }

      // Heard over him. Only "stop" or his name gets through; everything else
      // — the television, someone else in the room, his own voice — is ignored
      // and he carries on talking.
      if (guarded && wordsOnly(h)) {
        if (!halts(said, speakingNow())) {
          diag.ignored++
          drop(`ignored while he talks — "${said.slice(-40)}" (say "stop" or his name)`)
          return
        }
        learnVoice(loudness)
        diag.heard = said
        diag.heardAt = Date.now()
        diag.bargedOn = said
        diag.bargedOver = speakingNow()
        diag.dropped = ''
        diag.accepted++
        assemble.cancel()
        h.onSpeechStart()
        // The app strips his name and takes a bare "stop" as "be quiet"; any
        // words after them are the next request.
        h.onUtterance(said)
        return
      }

      // His own voice, come back through the microphone. The raised guard
      // threshold stops most of it at the door; this catches the rest.
      if (isEcho(said, speakingNow())) {
        drop('echo of his own voice')
        return
      }

      diag.heard = said
      diag.heardAt = Date.now()

      if (mode === 'wake') {
        if (WAKE.test(said) && Date.now() - lastWake > WAKE_DEBOUNCE) {
          lastWake = Date.now()
          diag.wakes++
          diag.dropped = ''
          diag.accepted++
          learnVoice(loudness)
          h.onWake(afterWake(said))
        } else {
          drop(`heard "${said.slice(-40)}" — not his name`)
        }
        return
      }

      if (WAKE.test(said)) learnVoice(loudness)
      // Not a turn yet — a piece of one. The assembler decides when the thought
      // is finished, reading the words and whether the room is still noisy.
      assemble.feed(said, vad?.meter().speaking ?? false)
    } catch (err) {
      diag.restarts++
      diag.lastError = String(err)
      drop('could not reach the speech service')
    }
  }

  /** One transcription at a time, in the order the segments were spoken. */
  const drain = async () => {
    if (draining) return
    draining = true
    try {
      while (pendingAudio.length) {
        await transcribe(pendingAudio.shift()!)
      }
    } finally {
      draining = false
    }
  }

  vad = await startVad({
    onStart: () => {
      const mode = h.mode()
      diag.mode = mode
      diag.sessions++
      capturingMode = mode
      capturingGuarded = mode === 'guard' && wordsOnly(h)
      if (mode === 'deaf') return
      // Standing down mid-thought throws the thought away with it. Otherwise
      // held text would surface as the opening of the *next* conversation.
      if (mode === 'wake') assemble.cancel()
      // Under the stop-words-only rule a sound is not an interruption; the
      // words decide, once they come back from the transcriber.
      if (capturingGuarded) return
      // The barge-in. In guard mode the user has started talking over him, and
      // because the guard threshold is high this is a real interruption rather
      // than leaked playback — so cut him off now, do not wait for the words.
      if (mode === 'guard') {
        const since = speakingSince()
        if (since && Date.now() - since < SELF_GUARD_MS) {
          diag.selfGuarded++
          return
        }
        h.onSpeechStart()
      }
    },
    onEnd: (blob, _ms, loudness) => {
      diag.segmentLevel = loudness
      // Far quieter than the user ever is: someone or something else. Dropped
      // here, before it costs a transcription.
      if (tooFaint(loudness, capturingMode)) {
        diag.faint++
        drop(`too quiet to be you (${Math.round((loudness / yourLevel()) * 100)}% of your level)`)
        return
      }
      pendingAudio.push({ blob, guarded: capturingGuarded, loudness })
      void drain()
    },
    onLevel: (v) => {
      // Only paint the live level while actually listening for a command, so a
      // dormant reactor stays calm and does not twitch at every room noise.
      const mode = h.mode()
      if (mode !== 'command') return
      // Never over the assembled text. This used to run unconditionally and
      // overwrote a half-built sentence with an ellipsis sixty times a second,
      // so a pause looked like the interface had forgotten what you just said.
      if (assemble.held()) return
      h.onPartial(v > 0.04 ? '…' : '')
    },
    onError: (message) => {
      diag.lastError = 'capture'
      diag.running = false
      h.onError(message)
    },
  })
  diag.running = vad.live()

  // Raise the trigger bar exactly while he speaks. The mode is polled rather
  // than pushed because nothing in the app pushes phase changes here, and a
  // 200ms lag on the echo gate is imperceptible.
  const guardPoll = setInterval(() => {
    const mode = h.mode()
    vad?.setGuard(mode === 'guard')
    // He has stood down — by Escape, by the idle timeout, or by dropping back
    // to the wake word. Anything half-said belonged to a conversation that is
    // over, and letting the hold expire later would open the next one with a
    // fragment of the last.
    if ((mode === 'wake' || mode === 'deaf') && assemble.held()) assemble.cancel()
  }, 200)

  return {
    stop: () => {
      clearInterval(guardPoll)
      assemble.cancel()
      vad?.stop()
      diag.running = false
    },
    live: () => vad?.live() ?? false,
  }
}

/* -------------------------------------------------------------------------- */
/* Browser fallback: SpeechRecognition                                        */
/* -------------------------------------------------------------------------- */

/**
 * The keyless path. Uses the browser's own SpeechRecognition for both detection
 * and transcription, so a student who has configured nothing still gets voice.
 *
 * It is the flakier engine — Chrome throttles it and it can go silent with no
 * event to catch — so a heartbeat watches it and forces a fresh session
 * whenever it stops showing signs of life. That single guard is the difference
 * between "the wake word stopped working halfway through the lesson" and an
 * assistant that keeps listening.
 */
function startBrowserVoice(h: VoiceHandlers): Voice {
  const Ctor =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
  if (!Ctor) {
    h.onError('This browser has no speech recognition — use Chrome or Edge, or add an ElevenLabs key.')
    return { stop: () => {}, live: () => false }
  }

  let stopped = false
  let running = false
  let rec: any = null
  let settled = ''
  let interim = ''
  let started = false
  let barged = false
  let lastWake = 0
  let lastAlive = Date.now()
  let silenceTimer: ReturnType<typeof setTimeout> | null = null

  /** Same assembly rules as the premium path — a pause is not a full stop. */
  const assemble = makeAssembler({
    emit: (text) => {
      diag.dropped = ''
      diag.accepted++
      diag.holding = ''
      h.onUtterance(text)
    },
    partial: (text) => h.onPartial(text),
  })

  const touch = () => {
    lastAlive = Date.now()
  }

  const clearSilence = () => {
    if (silenceTimer) clearTimeout(silenceTimer)
    silenceTimer = null
  }

  const reset = () => {
    clearSilence()
    settled = ''
    interim = ''
    started = false
    barged = false
  }

  const emit = () => {
    const text = `${settled} ${interim}`.replace(/\s+/g, ' ').trim()
    const mode = h.mode()
    reset()
    if (!text || mode === 'deaf') return
    if (isEcho(text, speakingNow())) {
      drop('echo of his own voice')
      return
    }
    diag.heard = text
    diag.heardAt = Date.now()
    if (mode === 'wake') {
      assemble.cancel()
      if (WAKE.test(text) && Date.now() - lastWake > WAKE_DEBOUNCE) {
        lastWake = Date.now()
        diag.wakes++
        diag.dropped = ''
        diag.accepted++
        h.onWake(afterWake(text))
      } else {
        drop(`heard "${text.slice(-40)}" — not his name`)
      }
      return
    }
    // The recogniser has already endpointed on its own 900ms gap; the assembler
    // decides whether that gap actually ended the thought. `false` because a
    // result only reaches here once the recogniser has gone quiet.
    assemble.feed(text, false)
  }

  const bumpSilence = () => {
    clearSilence()
    // Endpoint on a short quiet gap; the ElevenLabs path tunes this more
    // finely, but a fixed window is plenty for the fallback.
    silenceTimer = setTimeout(emit, 900)
  }

  const onResult = (e: any) => {
    touch()
    const mode = h.mode()
    diag.mode = mode
    if (mode === 'deaf') {
      interim = ''
      return
    }
    let fresh = ''
    interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript as string
      if (e.results[i].isFinal) fresh += chunk
      else interim += chunk
    }
    const heard = `${settled}${fresh} ${interim}`.replace(/\s+/g, ' ').trim()
    diag.partial = heard.slice(-120)
    if (!heard) return
    if (isEcho(`${fresh} ${interim}`, speakingNow())) {
      interim = ''
      return
    }

    if (mode === 'wake') {
      settled += fresh
      if (WAKE.test(heard) && Date.now() - lastWake > WAKE_DEBOUNCE) {
        lastWake = Date.now()
        diag.wakes++
        const trailing = afterWake(heard)
        reset()
        h.onWake(trailing)
      } else if (settled.length > 400) {
        settled = ''
      }
      return
    }

    settled += fresh
    const full = `${settled} ${interim}`.replace(/\s+/g, ' ').trim()
    // Stop-words-only: nothing but "stop" or his name cuts in, and the turn
    // that follows starts at that word rather than carrying his echo with it.
    if (mode === 'guard' && !barged && wordsOnly(h)) {
      if (!halts(full, speakingNow())) {
        // Not kept: whatever the television said must not open the next turn.
        if (fresh) diag.ignored++
        settled = ''
        return
      }
      const at = HALT.exec(full)?.index ?? 0
      settled = full.slice(at)
      interim = ''
      started = true
      barged = true
      diag.bargedOn = settled
      diag.bargedOver = speakingNow()
      diag.dropped = ''
      h.onSpeechStart()
      h.onPartial(settled)
      bumpSilence()
      return
    }
    if (!started || (mode === 'guard' && !barged)) {
      const words = full.split(/\s+/).filter(Boolean).length
      if (mode === 'guard') {
        // An override word cuts through everything below it — "stop" has to
        // work on the first syllable or it is not a stop button.
        if (!overrides(full, speakingNow())) {
          // His own first syllable, same as the premium path. This engine has
          // no energy gate, so without the clock the only defence is the word
          // count below, and a single clear word is exactly what leaks first.
          const since = speakingSince()
          if (since && Date.now() - since < SELF_GUARD_MS) {
            diag.selfGuarded++
            return
          }
          // Two words before this engine believes an interruption. The energy
          // path can be instant because it triggers on loudness the canceller
          // has already had a pass at; here the evidence is a transcript of
          // audio that includes his own playback, and one word of that is not
          // evidence of anything.
          if (words < 2) return
          if (foreignWords(`${fresh} ${interim}`, speakingNow()) < 2) {
            diag.selfGuarded++
            return
          }
        }
      }
      started = true
      if (mode === 'guard') {
        barged = true
        diag.bargedOn = full
        diag.bargedOver = speakingNow()
      }
      h.onSpeechStart()
    }
    diag.dropped = ''
    // Show the whole thought, not just the fragment being spoken now — there
    // may be an earlier half of it held by the assembler.
    const carried = assemble.held()
    h.onPartial(carried ? `${carried} ${full}` : full)
    bumpSilence()
  }

  const spin = () => {
    if (stopped || running) return
    rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = caps().language === 'ka' ? 'ka-GE' : 'en-GB'
    rec.onstart = () => {
      running = true
      diag.running = true
      diag.sessions++
      touch()
    }
    rec.onresult = onResult
    rec.onerror = (ev: any) => {
      diag.lastError = String(ev.error ?? '')
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        stopped = true
        diag.running = false
        h.onError('Microphone access was refused — voice input is unavailable.')
      }
    }
    rec.onend = () => {
      running = false
      diag.running = false
      touch()
      rec = null
      if (!stopped) setTimeout(spin, 80)
    }
    try {
      rec.start()
    } catch {
      running = false
      setTimeout(spin, 250)
    }
  }

  spin()

  // The heartbeat. If nothing has been heard from the engine for a while it has
  // gone quiet on us — tear it down and build a fresh one.
  const health = setInterval(() => {
    if (stopped) return
    const idle = Date.now() - lastAlive
    diag.idleMs = idle
    if (idle < 15000) return
    diag.restarts++
    try {
      rec?.abort()
    } catch {
      /* already gone */
    }
    rec = null
    running = false
    diag.running = false
    touch()
    spin()
  }, 5000)

  return {
    stop: () => {
      stopped = true
      clearInterval(health)
      clearSilence()
      assemble.cancel()
      diag.running = false
      try {
        rec?.abort()
      } catch {
        /* noop */
      }
    },
    live: () => running,
  }
}
