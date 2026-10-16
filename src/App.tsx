import { useEffect, useRef } from 'react'
import { Scene } from './scene/Scene'
import { Hud } from './ui/Hud'
import { Boot } from './ui/Boot'
import { introFinished } from './lib/intro'
import { applyAudioPrefs } from './lib/applyPrefs'
import { Ignition } from './ui/Ignition'
import { Diagnostics } from './ui/Diagnostics'
import { useStore } from './store'
import { NAME_KA, startVoice, type Voice, type VoiceMode } from './lib/voice'
import { createSpeaker, cycleVoice, currentVoiceName } from './lib/tts'
import * as sfx from './lib/sfx'
import * as music from './lib/music'
import * as hands from './lib/hands'
import { listenForClap } from './lib/clap'
import * as camera from './lib/camera'
import * as kokoro from './lib/kokoro'
import { TTS_ENGINE } from './config'
import { forTool, attention } from './lib/fillers'
import {
  ask,
  warm,
  interrupt,
  watchServers,
  watchPanels,
  watchBlades,
  watchCapture,
  watchConfirm,
  watchUi,
  watchReminders,
  watchConnection,
  connectedLabels,
  usingBridge,
  type Msg,
} from './lib/brain'
import { startAnalyser, micLevel } from './lib/audio'
import { caps, probeCapabilities } from './lib/capabilities'
import { isLocked, requireUnlock, useLock } from './lib/lock'

/**
 * The conversation.
 *
 * This used to be a sequential loop — greet, await a capture, await an answer,
 * repeat — with the microphone opened and closed around each step. That shape
 * cannot be interrupted: while it is awaiting the answer, nothing is listening,
 * so there is no way for the user to get a word in.
 *
 * It is an event machine now. The voice loop runs continuously and pushes
 * events at us; every one of them is legal in every phase. Saying "stop" or his
 * name stops him talking (or any speech at all, with stop-words-only switched
 * off in Settings), and whatever you say next becomes the new turn.
 */

/** How long to wait for someone to start speaking after he wakes. Generous:
 *  people say his name and *then* think about what they wanted. */
const AWAIT_SPEECH_MS = 14000

/** After an answer, how long the mic stays open for a follow-up before he
 *  drops back to standby. Long enough that you don't have to say the name
 *  again to continue a thought. */
const FOLLOW_UP_MS = 11000

/** crypto.randomUUID needs a secure context, which a LAN address over plain
 *  http is not. Not worth failing a whole turn over an id. */
const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/** The same mishearings voice.ts accepts for the wake word — otherwise a turn
 *  that woke him as "travis" gets that word sent on to the model as a question. */
const NAME = `(?:jarvis|jarvys|jervis|travis|jarviss|java's|jarv|${NAME_KA})`
/** End of a word in any script — \b only knows A–Z, and Georgian is not in it. */
const WORD_END = '(?![\\p{L}\\p{N}_])'
/** A bare vocative — "Jarvis", "hey jarvis" — with nothing asked. */
const BARE_NAME = new RegExp(`^(?:hey|hi|ok|okay|yo|ჰეი)?\\s*${NAME}[\\s,.!?]*$`, 'iu')
/** A leading vocative on a real command: "Jarvis, what's the weather". */
const LEADING_NAME = new RegExp(`^(?:hey|hi|ok|okay|yo|ჰეი)?\\s*${NAME}${WORD_END}[\\s,.:!?-]*`, 'iu')

/** Spoken answers to a confirmation. No is checked first: "no, go ahead" is
 *  not a yes, and a wrong no costs a retry where a wrong yes cannot be undone. */
const SAID_NO = new RegExp(
  "^(i\\s+)?(no|nope|nah|cancel|stop|don'?t|do not|deny|denied|decline|negative|abort|never ?mind|" +
    `არა|არ მინდა|არ გინდა|არ გააკეთო|გააუქმე|გაჩერდი|უარი)${WORD_END}`,
  'iu',
)
const SAID_YES = new RegExp(
  '^(i\\s+)?(yes|yeah|yep|yup|confirm(ed)?|approve(d)?|do it|go ahead|proceed|affirmative|okay|ok|sure|' +
    `კი|დიახ|ჰო|ხო|კარგი|ვადასტურებ|დადასტურებულია|გააკეთე|თანახმა ვარ)${WORD_END}`,
  'iu',
)

/** "Stop", "Jarvis, stop", "enough please" — be quiet, nothing asked. */
const BARE_STOP = new RegExp(
  `^(?:(?:hey|hi|ok|okay|yo|ჰეი)?\\s*${NAME}${WORD_END}[\\s,.!?]*)?` +
    '(?:stop|enough|cancel|quiet|be quiet|shut up|სტოპ|[ა-ჰ]{0,2}ჩერდი(?:თ)?|კმარა|შეწყვიტე|გაჩუმდი|გააუქმე|(?:g?a)?[cçč]h?er ?d[ei]|kmara)' +
    `(?:\\s+(?:it|that|talking|now|please|jarvis|ახლა|გეთაყვა))*[\\s,.!?]*$`,
  'iu',
)

/** After a confirmation is answered, the rest of the answer is still arriving:
 *  "yes… I confirm" reaches the recogniser as two utterances. For this long a
 *  short trailing phrase is taken as part of the answer, not as a new
 *  question — which would otherwise cut off the very action just approved. */
const CONFIRM_TAIL_MS = 3000
const CONFIRM_TAIL_WORDS = 4

function confirmVerdict(text: string): boolean | null {
  const said = text.replace(LEADING_NAME, '').replace(/^[\s,.!?]+/, '').trim()
  if (SAID_NO.test(said)) return false
  if (SAID_YES.test(said)) return true
  return null
}

export default function App() {
  const store = useStore
  const phase = useStore((s) => s.phase)
  const history = useRef<Msg[]>([])
  const speaker = useRef<ReturnType<typeof createSpeaker> | null>(null)
  const voice = useRef<Voice | null>(null)

  /**
   * Monotonic turn counter. Every await in a turn checks it on the way out:
   * if it has moved, that turn was superseded by a barge-in and must not touch
   * the phase, the speaker, or the busy state on its way to the floor.
   */
  const turn = useRef(0)
  const booting = useRef(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const voicePoll = useRef<ReturnType<typeof setInterval> | null>(null)
  /** Resolves the confirmation on screen, if there is one. */
  const answerConfirm = useRef<((approved: boolean) => void) | null>(null)
  const confirmAnsweredAt = useRef(0)
  const inConfirmTail = () => Date.now() - confirmAnsweredAt.current < CONFIRM_TAIL_MS

  // -- helpers --------------------------------------------------------------

  const clearIdle = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = null
  }

  const silence = () => {
    speaker.current?.cancel()
    speaker.current = null
  }

  const goDormant = () => {
    // Standing down is not consent.
    answerConfirm.current?.(false)
    clearIdle()
    silence()
    turn.current++
    const s = store.getState()
    s.setCaption('')
    s.setActiveTool(null)
    music.working(false)
    music.duck(false)
    sfx.duck(false)
    s.setPhase('dormant')
  }

  /** Open the mic and wait. `window` is how long before he gives up. */
  const listen = (window: number) => {
    clearIdle()
    const s = store.getState()
    s.setCaption('')
    s.setPhase('listening')
    sfx.play('listen')
    idleTimer.current = setTimeout(goDormant, window)
  }

  // -- one turn -------------------------------------------------------------

  const respond = async (said: string): Promise<void> => {
    const mine = ++turn.current
    const stale = () => mine !== turn.current

    clearIdle()
    const s = store.getState()
    // Last turn's panels and blades go now, before the new answer starts
    // putting its own up. Anything the model marked sticky survives.
    s.clearPanels()
    s.clearBlades()
    s.setCaption('')
    s.pushTurn({ id: newId(), role: 'user', text: said })
    s.setPhase('thinking')

    const spk = createSpeaker()
    speaker.current = spk
    sfx.duck(true)
    music.duck(true)

    const turnId = newId()
    let started = false
    let filled = false

    try {
      const { text } = await ask(said, history.current, {
        onText: (delta) => {
          if (stale()) return
          if (!started) {
            started = true
            store.getState().setPhase('speaking')
            // The answer arriving is what ends the tool phase — a timer would
            // clear the readout while a slow tool was still running.
            store.getState().setActiveTool(null)
            music.working(false)
            store.getState().pushTurn({ id: turnId, role: 'jarvis', text: '' })
          }
          store.getState().appendToLastTurn(delta)
          spk.push(delta)
        },
        onTool: (name) => {
          if (stale()) return
          // Only claim the tooling phase while he has nothing to say yet.
          // Setting it unconditionally pinned the machine in 'tooling' for the
          // rest of any answer that called a tool after it started talking,
          // which also broke the reactor's lip-sync for the remainder.
          if (!started) store.getState().setPhase('tooling')
          store.getState().setActiveTool(name)
          sfx.play('tool')
          music.working(true)
          // Say something the moment work starts — a tool can take ten seconds
          // and silence that long reads as a crash. Once per turn only; a
          // chain of five tools shouldn't produce five apologies.
          if (!filled && !started) {
            filled = true
            spk.say(forTool(name))
          }
        },
      })

      if (stale()) return

      // The bridge keeps conversation state in its own session, so history is
      // only threaded through on the direct path.
      if (!usingBridge) {
        history.current.push({ role: 'user', content: said })
        history.current.push({ role: 'assistant', content: text || '…' })
        if (history.current.length > 16) {
          history.current = history.current.slice(-16)
        }
      }

      await spk.end()
      if (stale()) return
      sfx.play('done')
    } catch (err) {
      if (stale()) return
      console.error(err)
      sfx.play('error')
      store
        .getState()
        .setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      if (!stale()) {
        speaker.current = null
        sfx.duck(false)
        music.duck(false)
        store.getState().setActiveTool(null)
        music.working(false)
        // Stay open. Having to say his name again to add one more sentence is
        // the difference between a conversation and a vending machine.
        listen(FOLLOW_UP_MS)
      }
    }
  }

  // -- voice events ---------------------------------------------------------

  /** What the voice loop should do with what it hears, derived from phase. */
  const mode = (): VoiceMode => {
    if (isLocked()) return 'deaf'
    switch (store.getState().phase) {
      case 'offline':
      case 'boot':
        return 'deaf'
      case 'dormant':
        return 'wake'
      case 'waking':
      case 'listening':
        return 'command'
      default:
        return 'guard' // thinking, tooling, speaking
    }
  }

  const onWake = (trailing: string) => {
    const phase = store.getState().phase
    if (phase === 'offline' || phase === 'boot' || isLocked()) return

    store.getState().setError(null)
    sfx.play('wake')

    // "Jarvis, what's happening in AI this week" in one breath. Waiting for a
    // greeting he didn't need is the most common way an assistant wastes time.
    if (trailing) {
      void respond(trailing)
      return
    }

    store.getState().setPhase('waking')

    // Answer to his name. Deliberately NOT awaited any more: the microphone is
    // already open and the echo filter knows his voice, so the user can talk
    // straight over the greeting instead of waiting it out.
    const greeting = createSpeaker()
    speaker.current = greeting
    greeting.say(attention())
    void greeting.end()

    listen(AWAIT_SPEECH_MS)
  }

  /**
   * Someone started talking. This is the whole point of the rewrite: he stops,
   * immediately, whatever he was doing.
   */
  const onSpeechStart = () => {
    clearIdle()
    // Waiting on a yes or no, or just given one: speech is the answer, not an
    // interruption, so the turn that asked must not be cut off.
    if (answerConfirm.current || inConfirmTail()) return
    const phase = store.getState().phase
    if (phase === 'offline' || phase === 'boot' || phase === 'dormant') return

    const wasBusy =
      phase === 'thinking' || phase === 'tooling' || phase === 'speaking'

    silence()
    if (wasBusy) {
      // Abandon the answer in flight. The turn counter moves in respond()'s
      // replacement; bumping it here covers the case where nothing replaces it.
      turn.current++
      interrupt()
      store.getState().setActiveTool(null)
      music.working(false)
      sfx.duck(false)
      music.duck(false)
    }
    store.getState().setPhase('listening')
  }

  const onUtterance = (text: string) => {
    const phase = store.getState().phase
    if (phase === 'offline' || phase === 'boot' || phase === 'dormant') return

    // Only a clear yes or no settles a confirmation; anything else is ignored
    // rather than taken as a new question or, worse, as consent.
    if (answerConfirm.current) {
      const verdict = confirmVerdict(text)
      if (verdict !== null) answerConfirm.current(verdict)
      return
    }
    if (inConfirmTail() && text.trim().split(/\s+/).length <= CONFIRM_TAIL_WORDS) return

    // He has already gone quiet (that was the barge-in); sending "stop" on to
    // the model as a question would only start him talking again.
    if (BARE_STOP.test(text.trim())) {
      listen(FOLLOW_UP_MS)
      return
    }

    // People keep using his name as a vocative once they're already talking to
    // him. Strip it rather than sending "jarvis" to the model as a question.
    if (BARE_NAME.test(text)) {
      listen(AWAIT_SPEECH_MS)
      return
    }
    const said = text.replace(LEADING_NAME, '').trim()
    if (!said) {
      listen(AWAIT_SPEECH_MS)
      return
    }

    void respond(said)
  }

  const onPartial = (text: string) => {
    store.getState().setCaption(text)
  }

  const onVoiceError = (message: string) => {
    store.getState().setError(message)
  }

  // -- power on -------------------------------------------------------------

  const powerOn = async () => {
    // The ignition button and the space bar can both land here, and the phase
    // only moves after the first await — so without this a double press boots
    // twice, arming two voice loops and two download polls.
    if (booting.current) return
    booting.current = true

    try {
      await ignite()
    } catch (err) {
      // The guard must not outlive a failed boot. Audio unlock can be refused,
      // the microphone prompt dismissed, the bridge unreachable at the wrong
      // moment — and with the flag still latched the ignition button was dead
      // for the rest of the page, recoverable only by reloading. Reset it and
      // put the button back so the user can simply press it again.
      booting.current = false
      console.error('[jarvis] power-up failed:', err)
      store.getState().setPhase('offline')
      store
        .getState()
        .setError(
          err instanceof Error
            ? `Power-up failed: ${err.message}`
            : 'Power-up failed. Click to try again.',
        )
    }
  }

  const ignite = async () => {
    const s = store.getState()

    // Must happen inside the click handler — browsers won't start an
    // AudioContext or speech synthesis without a user gesture.
    await sfx.unlockAudio()
    applyAudioPrefs()
    // The score. Must be enabled from inside this click handler for the same
    // reason as the rest of the audio. The intro film carries its own
    // soundtrack, so the boot tone and start-up cues stay silent under it.
    music.enable()

    const intro = introFinished()
    s.setPhase('boot')

    watchServers((servers) => store.getState().setConnected(servers))
    watchPanels((panel) => store.getState().pushPanel(panel))
    watchBlades((blade) => store.getState().pushBlade(blade))

    /**
     * JARVIS asking to see something.
     *
     * Announced on screen for as long as it takes, with whatever he said he was
     * looking for. The camera's own light is on too, but a hardware light that
     * appears with no explanation is exactly the thing that makes people
     * distrust an assistant — so the interface says it before they have to ask.
     */
    watchCapture(async (req) => {
      const note =
        req.mode === 'watch'
          ? req.when === 'past'
            ? req.reason || 'reviewing the last few seconds'
            : `${req.reason || 'watching'} · ${req.seconds}s`
          : req.reason || 'taking a look'
      store.getState().setLooking(note)

      // The past is only available if something has been remembering it, and
      // that only happens while the camera is on screen. Answering plainly
      // beats opening the camera and recording the next few seconds instead,
      // which is a different question from the one that was asked.
      if (req.mode === 'watch' && req.when === 'past' && camera.bufferedSeconds() < 1) {
        store.getState().setLooking(null)
        return {
          error:
            'There is no recent footage — the camera has to be open on screen ' +
            'for me to remember what just happened. Ask me to open the camera, ' +
            'and I can watch from then on.',
        }
      }

      // Held for the whole capture. Without this the stream can be torn down by
      // whoever else was using it half way through a six-second watch.
      let held = false
      try {
        await camera.holdCamera()
        held = true
        if (req.mode === 'look') return camera.grabFrame()
        if (req.when === 'past') {
          const grid = camera.recentGrid(req.seconds, 9)
          return grid ?? { error: 'There is not enough recent footage to review.' }
        }
        return await camera.watchAhead(req.seconds, 9)
      } catch (err) {
        return {
          error:
            (err as DOMException)?.name === 'NotAllowedError'
              ? 'The camera is not permitted, so I cannot see anything.'
              : `The camera could not be read: ${(err as Error)?.message ?? err}`,
        }
      } finally {
        if (held) camera.releaseCamera()
        store.getState().setLooking(null)
      }
    })

    /**
     * JARVIS asking permission for something that cannot be taken back.
     *
     * The bridge decides which actions need this and will not run them without
     * a yes from here. While the card is up the phase sits at 'listening', so
     * speech is heard as the answer instead of barging in on the turn that
     * asked. Silence until the bridge's deadline counts as no.
     */
    watchConfirm(
      (req) =>
        new Promise<boolean>((resolve) => {
          answerConfirm.current?.(false)
          const before = store.getState().phase
          let settled = false
          const answer = (approved: boolean) => {
            if (settled) return
            settled = true
            confirmAnsweredAt.current = Date.now()
            if (answerConfirm.current === answer) answerConfirm.current = null
            const st = store.getState()
            if (st.confirm?.id === req.id) st.setConfirm(null)
            if (st.phase === 'listening') {
              st.setPhase(before === 'speaking' || before === 'tooling' ? before : 'thinking')
            }
            resolve(approved)
          }
          answerConfirm.current = answer
          const st = store.getState()
          st.setConfirm({
            id: req.id,
            action: req.action,
            detail: req.detail,
            expires: Date.now() + req.timeoutMs,
            answer,
          })
          clearIdle()
          st.setPhase('listening')
          sfx.play('listen')
          const spk = speaker.current ?? createSpeaker()
          spk.say(caps().language === 'ka' ? 'საჭიროა თქვენი დადასტურება, ბატონო.' : 'Your confirmation is required, sir.')
        }),
      (id) => {
        if (store.getState().confirm?.id === id) answerConfirm.current?.(false)
      },
    )

    // The interface is JARVIS's to drive. These arrive out of band, pushed
    // mid-turn the way panels are, so a command can retint the reactor or put
    // something into orbit while he is still speaking the sentence about it.
    watchUi((op, args) => {
      const s = store.getState()
      const a = (args ?? {}) as Record<string, never>
      switch (op) {
        case 'patch':
          s.applyUi(args)
          break
        case 'orbit':
          if (a.action === 'add') s.addOrbit(args)
          else if (a.action === 'remove') s.removeOrbit(String(a.id))
          else s.clearOrbits()
          break
        case 'effect':
          s.fireEffect(a.kind)
          break
        case 'reset':
          s.resetUi()
          break
        case 'screen':
          s.clearScreen(a.what ?? 'all')
          break
        default:
          console.warn('[jarvis] unknown ui op:', op, args)
      }
    })
    // A reminder never talks over him or over a question on screen: it waits
    // for the answer in progress to finish (up to two minutes), then speaks
    // and leaves the mic open, so "snooze it ten minutes" needs no wake word.
    watchReminders(async (r) => {
      const busy = () => {
        const st = store.getState()
        return st.confirm !== null || ['boot', 'thinking', 'tooling', 'speaking'].includes(st.phase)
      }
      const deadline = Date.now() + 120_000
      while (busy() && Date.now() < deadline) await new Promise((ok) => setTimeout(ok, 500))
      if (store.getState().phase === 'offline' || isLocked()) return

      const mine = ++turn.current
      clearIdle()
      silence()
      const st = store.getState()
      st.setError(null)
      st.pushTurn({ id: newId(), role: 'jarvis', text: r.say })
      st.setPhase('speaking')
      sfx.play('wake')
      const spk = createSpeaker()
      speaker.current = spk
      spk.say(r.say)
      await spk.end()
      if (mine !== turn.current) return
      speaker.current = null
      listen(FOLLOW_UP_MS)
    })

    // In bridge mode the conversation lives in the agent session, which is tied
    // to the socket — so a drop silently wipes his memory while the transcript
    // on screen still shows it. Better to say so than to let him quietly forget.
    watchConnection((state) => {
      if (state === 'lost') {
        store.getState().setError('Bridge connection lost — reconnecting.')
      } else if (state === 'reconnected') {
        store
          .getState()
          .setError('Bridge reconnected. The previous conversation was not kept.')
      }
    })
    const warming = warm().catch((err: Error) => s.setError(err.message))

    // Pull the neural voice down during the boot sequence so the first
    // "Hey Jarvis" isn't waiting on an 86MB download. Deliberately not awaited
    // — if it's slow, JARVIS comes up on the system voice and swaps over the
    // moment the model is ready.
    if (TTS_ENGINE === 'kokoro') {
      void kokoro.load()
      voicePoll.current = setInterval(() => {
        const p = kokoro.loadProgress()
        if (kokoro.isReady() || kokoro.isUnavailable()) {
          store.getState().setBootNote('')
          if (voicePoll.current) clearInterval(voicePoll.current)
          voicePoll.current = null
        } else if (p > 0 && p < 1) {
          store.getState().setBootNote(`voice ${Math.round(p * 100)}%`)
        }
      }, 200)
    }

    // The intro film plays out (or is clicked away) before the live interface
    // takes over.
    await intro
    await warming

    // The passcode, before the microphone opens or a word can reach the model.
    // Out of 'boot' first: the intro film shows for as long as that phase lasts.
    const unlocked = requireUnlock()
    store.getState().setPhase('dormant')
    await unlocked

    store.getState().setConnected(connectedLabels())
    store.getState().setVoice(currentVoiceName())

    // The analyser is what makes the reactor pulse with your voice. It needs a
    // getUserMedia stream; speech recognition does not, and gets its own. So a
    // failure here costs the animation and nothing else — saying "voice input
    // is unavailable" was both alarming and untrue.
    try {
      await startAnalyser()
    } catch {
      console.warn(
        '[jarvis] no microphone stream — the reactor will not pulse with your ' +
          'voice. Speech recognition is unaffected.',
      )
    }

    // Ask the bridge which speech engines exist before the loop starts, so the
    // first turn already uses ElevenLabs when a key is present and the browser
    // fallback when it is not — no flag, no reload.
    await probeCapabilities()

    // One voice loop, started once, running until the page closes.
    voice.current = await startVoice({
      mode,
      onWake,
      onSpeechStart,
      onPartial,
      onUtterance,
      answering: () => !!answerConfirm.current || inConfirmTail(),
      onError: onVoiceError,
    })

    store.getState().setPhase('dormant')
  }

  // -- clap to start --------------------------------------------------------

  /**
   * A clap brings him up, as an alternative to the button.
   *
   * Only while the ignition screen is showing, and torn down the moment he
   * boots — the microphone is about to belong to the voice loop, and two
   * analysers arguing over the same stream is how you get an assistant that
   * hears half of what you say.
   *
   * Deliberately silent about failure. If the microphone is refused, or has not
   * been granted yet, the button is still right there; announcing an error
   * about a feature nobody asked for would be worse than quietly doing without.
   */
  useEffect(() => {
    if (phase !== 'offline') return
    let live: { stop: () => void } | null = null
    let gone = false
    void listenForClap(() => {
      if (!gone) void powerOn()
    }).then((l) => {
      if (gone) l.stop()
      else live = l
    })
    return () => {
      gone = true
      live?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  /**
   * The desktop app (scripts/desktop.mjs) opens the page with ?autostart, in a
   * Chrome profile that lets audio start without a click, so the icon — or
   * signing in to Windows — brings him straight up. In an ordinary tab the
   * browser still wants the click, and a refused boot leaves the button there.
   */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('autostart')) void powerOn()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -- level pump + keys ----------------------------------------------------

  useEffect(() => {
    let raf = 0

    const pump = () => {
      const st = store.getState()
      // While speaking, follow JARVIS's own output rather than the mic, so the
      // orb lip-syncs instead of reacting to room noise.
      const lvl =
        st.phase === 'speaking' && speaker.current
          ? speaker.current.level()
          : micLevel()
      st.setLevel(lvl)
      raf = requestAnimationFrame(pump)
    }
    pump()

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      // The keypad owns the keyboard while locked (SecureAccess.tsx).
      if (isLocked()) return

      // A pending confirmation takes the keyboard: Y or Enter approves, N
      // denies, and Space is held back so it can't start a turn over the top.
      if (answerConfirm.current && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'y' || k === 'enter' || k === 'n') {
          e.preventDefault()
          if (!e.repeat) answerConfirm.current(k !== 'n')
          return
        }
        if (e.code === 'Space') {
          e.preventDefault()
          return
        }
      }

      // V auditions the next British voice installed on this machine. Which
      // ones exist varies per Mac, so hearing them beats trusting a ranking.
      // Bare V only — ⌘V and ⌃V are paste, and swallowing those was rude.
      if (
        e.key === 'v' &&
        !e.repeat &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault()
        const name = cycleVoice()
        store.getState().setVoice(name)
        silence()
        const demo = createSpeaker()
        speaker.current = demo
        demo.say(`Voice set to ${name.replace(/\(.*?\)/g, '').trim()}. At your service, sir.`)
        void demo.end()
        return
      }

      // G puts the camera on and starts tracking hands. Off by default and
      // never implicit: a webcam that turns itself on because an interface
      // thought it might be useful is not a trade anyone agreed to.
      if (e.key === 'g' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        const on = store.getState().gestures
        if (on) {
          hands.disableHands()
          store.getState().setGestures(false)
        } else {
          store.getState().setError(null)
          void hands
            .enableHands()
            .then(() => store.getState().setGestures(true))
            .catch((err: Error) => {
              store.getState().setGestures(false)
              store
                .getState()
                .setError(
                  err?.name === 'NotAllowedError'
                    ? 'Camera access denied — gesture control is unavailable.'
                    : `Gesture control failed to start: ${err?.message ?? err}`,
                )
            })
        }
        return
      }

      // T speaks a fixed line, bypassing the wake word, the recogniser and the
      // model entirely. When "I can't hear him" is the report, this is the one
      // keypress that separates a broken voice engine from a broken voice loop
      // — and it prints the verdict rather than making you infer it.
      if (e.key === 't' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        silence()
        const t = createSpeaker()
        speaker.current = t
        t.say('Audio test. If you can hear this, speech output is working, sir.')
        void t.end().then(() => {
          const d = (window as unknown as Record<string, Record<string, unknown>>).__tts
          console.info('[jarvis] audio test →', d)
          if (d && d.started === 0 && d.rescued === 0) {
            store.getState().setError(
              `No sound produced. engine=${d.engine} voice=${d.voice} error=${d.lastError || 'none'}`,
            )
          }
        })
        return
      }

      // Escape stands the whole thing down — the one thing the old build had
      // no key for at all.
      if (e.key === 'Escape') {
        e.preventDefault()
        if (store.getState().phase !== 'offline') goDormant()
        return
      }

      // Space starts a turn without the wake word. Worth using while filming so
      // a missed wake word doesn't cost a take.
      if (e.code !== 'Space' || e.repeat) return
      e.preventDefault()
      talk()
    }

    const talk = () => {
      const phase = store.getState().phase
      if (isLocked()) return
      if (phase === 'offline') {
        void powerOn()
      } else if (phase === 'boot') {
        /* ignore — the boot sequence owns the phase until it finishes */
      } else if (
        phase === 'thinking' ||
        phase === 'tooling' ||
        phase === 'speaking'
      ) {
        onSpeechStart()
        listen(AWAIT_SPEECH_MS)
      } else {
        onWake('')
      }
    }

    // The command deck's prompt bar and mic button. Typed text is treated
    // exactly like speech: a pending confirmation only accepts a clear yes or
    // no, and anything typed over an answer in flight interrupts it.
    const onAsk = (e: Event) => {
      const text = String((e as CustomEvent<string>).detail ?? '').trim()
      const phase = store.getState().phase
      if (!text || phase === 'offline' || phase === 'boot' || isLocked()) return
      if (answerConfirm.current) {
        const verdict = confirmVerdict(text)
        if (verdict !== null) answerConfirm.current(verdict)
        return
      }
      if (phase === 'thinking' || phase === 'tooling' || phase === 'speaking') onSpeechStart()
      onWake(text)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('jarvis:ask', onAsk)
    window.addEventListener('jarvis:talk', talk)

    // Locking mid-conversation (Settings → LOCK NOW) stands him down first,
    // the camera included.
    const unwatchLock = useLock.subscribe((s, prev) => {
      if (!s.locked || prev.locked) return
      if (store.getState().gestures) {
        hands.disableHands()
        store.getState().setGestures(false)
      }
      const phase = store.getState().phase
      if (phase !== 'offline' && phase !== 'boot') goDormant()
    })

    return () => {
      unwatchLock()
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('jarvis:ask', onAsk)
      window.removeEventListener('jarvis:talk', talk)
      clearIdle()
      if (voicePoll.current) clearInterval(voicePoll.current)
      voice.current?.stop()
      speaker.current?.cancel()
      // The camera must not outlive the page that turned it on.
      hands.disableHands()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <Scene />
      <Hud />
      <Boot />
      <Diagnostics />
      <Ignition onStart={() => void powerOn()} />
    </>
  )
}
