import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../../store'
import { updatePrefs } from '../../lib/applyPrefs'
import { probeCapabilities, caps, ttsProviderLabel } from '../../lib/capabilities'
import { usePrefs, type ReactorStyle } from '../../lib/prefs'
import {
  changeAssistant,
  loadAssistant,
  loadSettings,
  saveSettings,
  waitForBridge,
  type AssistantData,
  type BridgeSettings,
  type KeyName,
  type Routine,
  type SettingsView,
} from '../../lib/settings'
import { chooseVoice, chosenVoice, currentVoiceName, englishVoices } from '../../lib/tts'
import { lockNow, lockStatus, passcode, type LockMode } from '../../lib/lock'
import { Panel } from './frame'

/**
 * Customise JARVIS. Two kinds of setting, saved two ways:
 *   - look, intro, voice and sound apply at once and live in this browser;
 *   - the brain, keys, permissions and personality are saved by the bridge,
 *     which restarts itself in a couple of seconds to apply them.
 */

const ACCENTS: [string, string | null][] = [
  ['LIVE GREEN', null],
  ['CYAN', '#35e6ff'],
  ['ARC BLUE', '#4d8dff'],
  ['VIOLET', '#b18cff'],
  ['CRIMSON', '#ff4d5e'],
  ['AMBER', '#ffb340'],
  ['GOLD', '#ffd166'],
  ['WHITE', '#e6f7ff'],
]

const STYLES: ReactorStyle[] = ['ring', 'sphere', 'wire']

const KEY_LABEL: Record<KeyName, string> = { openai: 'OPENAI API KEY', gemini: 'GEMINI API KEY', elevenlabs: 'ELEVENLABS KEY (VOICE)' }

const FIELDS: (keyof BridgeSettings)[] = [
  'provider',
  'openaiModel',
  'geminiModel',
  'weatherCity',
  'pcControl',
  'commands',
  'userName',
  'instructions',
  'voiceId',
  'language',
]

type Status = { kind: 'idle' | 'busy' | 'ok' | 'error'; text: string }

function Toggle({ on, onChange, label, note }: { on: boolean; onChange: (v: boolean) => void; label: string; note?: string }) {
  return (
    <label className="cc-toggle">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="cc-toggle-track"><span /></span>
      <span className="cc-toggle-text">
        <b>{label}</b>
        {note && <small>{note}</small>}
      </span>
    </label>
  )
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="cc-field">
      <span className="cc-k">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  )
}

/* ------------------------------------------------------ saved by the bridge */

function BridgeSection() {
  const [view, setView] = useState<SettingsView | null>(null)
  const [draft, setDraft] = useState<BridgeSettings | null>(null)
  const [keys, setKeys] = useState<Record<KeyName, string>>({ openai: '', gemini: '', elevenlabs: '' })
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' })

  const adopt = (v: SettingsView) => {
    setView(v)
    setDraft(Object.fromEntries(FIELDS.map((f) => [f, v[f]])) as BridgeSettings)
    setKeys({ openai: '', gemini: '', elevenlabs: '' })
  }

  useEffect(() => {
    loadSettings()
      .then(adopt)
      .catch(() => setStatus({ kind: 'error', text: 'Cannot reach the bridge — is JARVIS running?' }))
  }, [])

  if (!view || !draft) {
    return (
      <Panel title="BRAIN & PERMISSIONS" className="cc-span-3">
        <div className={status.kind === 'error' ? 'cc-warn' : 'cc-dim'}>{status.text || 'Loading…'}</div>
      </Panel>
    )
  }

  const set = <K extends keyof BridgeSettings>(k: K, v: BridgeSettings[K]) => setDraft({ ...draft, [k]: v })
  const changed = FIELDS.filter((f) => draft[f] !== view[f])
  const newKeys = (Object.keys(keys) as KeyName[]).filter((k) => keys[k].trim())
  const dirty = changed.length > 0 || newKeys.length > 0

  const save = async () => {
    setStatus({ kind: 'busy', text: 'Saving…' })
    try {
      const result = await saveSettings({
        settings: Object.fromEntries(changed.map((f) => [f, draft[f]])),
        keys: Object.fromEntries(newKeys.map((k) => [k, keys[k].trim()])),
      })
      if (!result.restarting) {
        adopt(await loadSettings())
        setStatus({ kind: 'ok', text: 'Saved. Restart JARVIS to apply it (the bridge is not running under npm start).' })
        return
      }
      setStatus({ kind: 'busy', text: 'Saved. Restarting his brain…' })
      const fresh = await waitForBridge()
      adopt(fresh)
      await probeCapabilities()
      useStore.getState().setVoice(currentVoiceName())
      setStatus(
        fresh.brain.ready
          ? { kind: 'ok', text: `Applied — ${fresh.brain.provider} · ${fresh.brain.model} is online.` }
          : { kind: 'error', text: `Applied, but the brain is not answering: ${fresh.brain.error ?? 'still checking'}` },
      )
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  const keyFor: Record<string, KeyName> = { openai: 'openai', gemini: 'gemini', vertex: 'gemini' }
  const windows = view.platform === 'win32'

  return (
    <>
      <Panel title="IDENTITY">
        <Field label="YOUR NAME" hint="How JARVIS addresses you. Blank: sir.">
          <input className="cc-text" maxLength={40} value={draft.userName} onChange={(e) => set('userName', e.target.value)} placeholder="sir" />
        </Field>
        <Field label="STANDING INSTRUCTIONS" hint={`${draft.instructions.length}/2000 — e.g. “Answer in Russian.” “Be brief.” “Call my PC the rig.”`}>
          <textarea
            className="cc-text cc-textarea"
            maxLength={2000}
            value={draft.instructions}
            onChange={(e) => set('instructions', e.target.value)}
            placeholder="Anything he should always keep in mind."
          />
        </Field>
        <Field
          label="LANGUAGE"
          hint={
            draft.language === 'ka'
              ? 'He listens for Georgian and answers in it. His Georgian voice needs the ElevenLabs key; it uses their v3 model, which spends more credits per character.'
              : 'English. Speak to him in Georgian and he answers that in Georgian.'
          }
        >
          <div className="cc-seg">
            <button className={draft.language === 'en' ? 'on' : ''} onClick={() => set('language', 'en')}>
              ENGLISH
            </button>
            <button className={draft.language === 'ka' ? 'on' : ''} onClick={() => set('language', 'ka')}>
              ქართული
            </button>
          </div>
        </Field>
        <Field label="WEATHER CITY" hint="For the weather readouts. Blank turns them off.">
          <input className="cc-text" maxLength={80} value={draft.weatherCity} onChange={(e) => set('weatherCity', e.target.value)} placeholder="e.g. Tbilisi" />
        </Field>
      </Panel>

      <Panel title="BRAIN" tag={<span className={view.brain.ready ? 'cc-live' : 'cc-warn'}>{view.brain.ready ? 'ONLINE' : view.brain.checked ? 'CHECK KEY' : 'CHECKING'}</span>}>
        <Field label="AI PROVIDER">
          <div className="cc-seg">
            {(['openai', 'gemini', ...(view.provider === 'vertex' ? ['vertex' as const] : [])] as const).map((p) => (
              <button key={p} className={draft.provider === p ? 'on' : ''} onClick={() => set('provider', p)}>
                {p === 'openai' ? 'OPENAI' : p === 'gemini' ? 'GEMINI' : 'VERTEX'}
              </button>
            ))}
          </div>
        </Field>
        {draft.provider === 'openai' && (
          <Field label="OPENAI MODEL">
            <input className="cc-text" value={draft.openaiModel} onChange={(e) => set('openaiModel', e.target.value.trim())} />
          </Field>
        )}
        {draft.provider === 'gemini' && (
          <Field label="GEMINI MODEL">
            <input className="cc-text" value={draft.geminiModel} onChange={(e) => set('geminiModel', e.target.value.trim())} />
          </Field>
        )}
        {(['openai', 'gemini', 'elevenlabs'] as KeyName[])
          .filter((k) => k === 'elevenlabs' || k === keyFor[draft.provider])
          .map((k) => (
            <Field key={k} label={KEY_LABEL[k]} hint={view.keys[k] ? 'A key is saved. Paste a new one only to replace it.' : 'Not set.'}>
              <input
                className="cc-text"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keys[k]}
                onChange={(e) => setKeys({ ...keys, [k]: e.target.value })}
                placeholder={view.keys[k] ? '•••••••••• saved' : 'paste key'}
              />
            </Field>
          ))}
        <Field
          label="ELEVENLABS VOICE ID"
          hint={view.keys.elevenlabs ? 'The voice he speaks with. Copy it from the voice’s page on elevenlabs.io.' : 'Used once an ElevenLabs key is set.'}
        >
          <input
            className="cc-text"
            maxLength={40}
            spellCheck={false}
            value={draft.voiceId}
            onChange={(e) => set('voiceId', e.target.value.trim())}
          />
        </Field>
        {view.brain.error && <p className="cc-note cc-warn">{view.brain.error}</p>}
      </Panel>

      <Panel title="PERMISSIONS">
        <Toggle
          on={draft.pcControl}
          onChange={(v) => set('pcControl', v)}
          label="CONTROL THIS PC"
          note={windows ? 'Windows, apps, keyboard, mouse, volume, power.' : 'Windows only.'}
        />
        <Toggle on={draft.commands} onChange={(v) => set('commands', v)} label="RUN COMMANDS" note="PowerShell and cmd, including as administrator." />
        <p className="cc-note">Anything risky — deleting, sending, buying, clicking, typing, commands — always asks you first. That stays on.</p>
      </Panel>

      <div className="cc-save-bar cc-span-3">
        <span className={`cc-status cc-status-${status.kind}`}>
          {status.text || (dirty ? `${changed.length + newKeys.length} unsaved change${changed.length + newKeys.length === 1 ? '' : 's'}` : 'All saved.')}
        </span>
        <button className="cc-btn" disabled={!dirty || status.kind === 'busy'} onClick={() => adopt(view)}>
          UNDO
        </button>
        <button className="cc-btn cc-btn-primary" disabled={!dirty || status.kind === 'busy'} onClick={() => void save()}>
          SAVE & APPLY
        </button>
      </div>
    </>
  )
}

/* ------------------------------------------ memory, reminders and routines */

const REMINDER_KIND = { reminder: 'REMINDER', timer: 'TIMER', alarm: 'ALARM' }
const REPEAT = { none: '', daily: ' · DAILY', weekdays: ' · WEEKDAYS' }

function dueLabel(due: number) {
  const d = new Date(due)
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const today = new Date().toDateString() === d.toDateString()
  return today ? `TODAY ${time}` : `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()} ${time}`
}

function KeptSection() {
  const [data, setData] = useState<AssistantData | null>(null)
  const [routines, setRoutines] = useState<Routine[]>([])
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' })
  const [routinesDirty, setDirtyState] = useState(false)
  const editing = useRef(false)
  const setRoutinesDirty = (v: boolean) => {
    editing.current = v
    setDirtyState(v)
  }

  // Reminders and memories also change by voice, so the lists keep up while the page is open.
  useEffect(() => {
    let alive = true
    const pull = () =>
      loadAssistant()
        .then((d) => {
          if (!alive) return
          setData(d)
          if (!editing.current) setRoutines(d.routines)
        })
        .catch(() => alive && setStatus({ kind: 'error', text: 'Cannot reach the bridge — is JARVIS running?' }))
    void pull()
    const timer = setInterval(pull, 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const change = async (c: Parameters<typeof changeAssistant>[0]) => {
    try {
      const d = await changeAssistant(c)
      setData(d)
      if (c.op === 'routines') {
        setRoutines(d.routines)
        setRoutinesDirty(false)
        setStatus({ kind: 'ok', text: 'Routines saved. He knows them from his next answer.' })
      }
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  const editRoutine = (i: number, patch: Partial<Routine>) => {
    setRoutines(routines.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setRoutinesDirty(true)
  }

  if (!data) {
    return (
      <Panel title="MEMORY · REMINDERS · ROUTINES" className="cc-span-3">
        <div className={status.kind === 'error' ? 'cc-warn' : 'cc-dim'}>{status.text || 'Loading…'}</div>
      </Panel>
    )
  }

  return (
    <>
      <Panel title="MEMORY" tag={<span className="cc-dim">{data.memories.length}</span>}>
        {data.memories.length ? (
          <ul className="cc-kept">
            {data.memories.map((m) => (
              <li key={m.id}>
                <span>{m.text}</span>
                <button className="cc-link-btn" title="Forget this" onClick={() => void change({ op: 'forget', id: m.id })}>
                  FORGET
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cc-note">Nothing yet. Say “Jarvis, remember that …” and it stays here, across restarts.</p>
        )}
      </Panel>

      <Panel title="REMINDERS" tag={<span className="cc-dim">{data.reminders.length}</span>}>
        {data.reminders.length ? (
          <ul className="cc-kept">
            {data.reminders.map((r) => (
              <li key={r.id}>
                <span>
                  <b>{dueLabel(r.due)}</b> <small>{REMINDER_KIND[r.kind]}{REPEAT[r.repeat]}</small>
                  <br />
                  {r.text || '—'}
                </span>
                <button className="cc-link-btn" onClick={() => void change({ op: 'cancel', id: r.id })}>
                  CANCEL
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cc-note">None set. “Remind me at six to call mum”, “a ten-minute timer”, “wake me at seven on weekdays”.</p>
        )}
      </Panel>

      <Panel title="ROUTINES" tag={<span className="cc-dim">{routines.length}/20</span>}>
        <p className="cc-note">Say the name and he does the steps, in order. Anything risky still asks first.</p>
        {routines.map((r, i) => (
          <div className="cc-routine" key={i}>
            <div className="cc-inline">
              <input
                className="cc-text"
                maxLength={40}
                value={r.name}
                placeholder="name, e.g. gaming mode"
                onChange={(e) => editRoutine(i, { name: e.target.value })}
              />
              <button
                className="cc-btn"
                onClick={() => {
                  setRoutines(routines.filter((_, j) => j !== i))
                  setRoutinesDirty(true)
                }}
              >
                REMOVE
              </button>
            </div>
            <textarea
              className="cc-text cc-textarea"
              maxLength={800}
              value={r.steps}
              placeholder={'One step per line, e.g.\nOpen Steam\nOpen Discord\nSet the volume to 40%'}
              onChange={(e) => editRoutine(i, { steps: e.target.value })}
            />
          </div>
        ))}
        <div className="cc-inline">
          <button
            className="cc-btn"
            disabled={routines.length >= 20}
            onClick={() => {
              setRoutines([...routines, { name: '', steps: '' }])
              setRoutinesDirty(true)
            }}
          >
            + ADD ROUTINE
          </button>
          <button
            className="cc-btn cc-btn-primary"
            disabled={!routinesDirty}
            onClick={() => void change({ op: 'routines', routines: routines.map((r) => ({ name: r.name.trim(), steps: r.steps.trim() })) })}
          >
            SAVE ROUTINES
          </button>
        </div>
        {status.text && <p className={`cc-note cc-status-${status.kind}`}>{status.text}</p>}
      </Panel>
    </>
  )
}

/* ----------------------------------------------------- saved in the browser */

function LookSection() {
  const prefs = usePrefs()
  return (
    <Panel title="APPEARANCE">
      <Field label="INTERFACE COLOUR">
        <div className="cc-swatches">
          {ACCENTS.map(([name, hex]) => (
            <button
              key={name}
              title={name}
              className={`cc-swatch ${prefs.accent === hex ? 'on' : ''}`}
              style={{ ['--sw' as string]: hex ?? '#2ef27f' }}
              onClick={() => updatePrefs({ accent: hex })}
            >
              <span />
              <small>{name}</small>
            </button>
          ))}
        </div>
      </Field>
      <Field label="REACTOR">
        <div className="cc-seg">
          {STYLES.map((s) => (
            <button key={s} className={prefs.reactorStyle === s ? 'on' : ''} onClick={() => updatePrefs({ reactorStyle: s })}>
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </Field>
      <Field label={`REACTOR SPIN · ${prefs.reactorSpin.toFixed(1)}×`}>
        <input
          className="cc-range"
          type="range"
          min={0}
          max={3}
          step={0.1}
          value={prefs.reactorSpin}
          onChange={(e) => updatePrefs({ reactorSpin: Number(e.target.value) })}
        />
      </Field>
      <Toggle
        on={prefs.depth3d}
        onChange={(v) => updatePrefs({ depth3d: v })}
        label="3D DEPTH"
        note="Gyro rings and a lattice around the reactor, which turns to follow your mouse. Off for a slower PC."
      />
      <Toggle on={prefs.intro} onChange={(v) => updatePrefs({ intro: v })} label="INTRO FILM AT START-UP" note="Off: straight to the deck." />
    </Panel>
  )
}

function VoiceSection() {
  const prefs = usePrefs()
  const [voices, setVoices] = useState(() => englishVoices())
  const [chosen, setChosen] = useState(() => chosenVoice() ?? '')

  useEffect(() => {
    const refresh = () => setVoices(englishVoices())
    speechSynthesis.addEventListener('voiceschanged', refresh)
    return () => speechSynthesis.removeEventListener('voiceschanged', refresh)
  }, [])

  const pick = (name: string) => {
    setChosen(name)
    chooseVoice(name || null)
    useStore.getState().setVoice(currentVoiceName())
  }

  const test = () => {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance('Good evening. All systems are at your disposal.')
    const v = voices.find((x) => x.name === (chosen || currentVoiceName()))
    if (v) {
      u.voice = v
      u.lang = v.lang
    }
    u.rate = 0.92
    u.pitch = 0.95
    speechSynthesis.speak(u)
  }

  const cloud = caps().tts

  return (
    <Panel title="VOICE & SOUND">
      <Field label="VOICE" hint={cloud ? `He currently speaks with ${ttsProviderLabel()}; this voice is the fallback.` : undefined}>
        <div className="cc-inline">
          <select className="cc-text" value={chosen} onChange={(e) => pick(e.target.value)}>
            <option value="">AUTOMATIC (BEST BRITISH MALE)</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} · {v.lang}
              </option>
            ))}
          </select>
          <button className="cc-btn" onClick={test}>TEST</button>
        </div>
      </Field>
      <Field label={`SOUND EFFECTS · ${Math.round(prefs.sfxVolume * 100)}%`}>
        <input
          className="cc-range"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={prefs.sfxVolume}
          onChange={(e) => updatePrefs({ sfxVolume: Number(e.target.value) })}
        />
      </Field>
      <Toggle on={prefs.music} onChange={(v) => updatePrefs({ music: v })} label="WORKING MUSIC" note="The soft cue while he runs a tool." />
      <Toggle
        on={prefs.stopWordsOnly}
        onChange={(v) => updatePrefs({ stopWordsOnly: v })}
        label="ONLY “STOP” OR HIS NAME INTERRUPTS"
        note={
          prefs.stopWordsOnly
            ? 'He keeps talking through noise and other voices. Say “stop” (or “გაჩერდი”) or “Jarvis” to cut in.'
            : 'Any speech cuts him off — including a TV or someone else in the room.'
        }
      />
      <Toggle
        on={prefs.voiceFocus}
        onChange={(v) => updatePrefs({ voiceFocus: v })}
        label="ONLY MY VOICE"
        note={
          caps().stt
            ? 'Ignores sound much quieter than you — a TV, music, people across the room. He learns your level each time you say his name. Takes full effect the next time he starts.'
            : 'He is listening through Chrome’s speech recognition, which cannot tell how loud each phrase was — so this only steadies the microphone level. The full filter needs ElevenLabs listening.'
        }
      />
    </Panel>
  )
}

const SIX = /^\d{6}$/
const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 6)

function SecuritySection() {
  const [mode, setMode] = useState<LockMode | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' })

  useEffect(() => {
    lockStatus()
      .then((s) => setMode(s.mode))
      .catch(() => setStatus({ kind: 'error', text: 'Cannot reach the bridge — is JARVIS running?' }))
  }, [])

  const run = async (op: 'change' | 'remove', done: string) => {
    setStatus({ kind: 'busy', text: 'Checking…' })
    try {
      const r = await passcode(op, { current, code: next })
      setMode(r.mode)
      if (!r.ok) return setStatus({ kind: 'error', text: r.error ?? 'Refused.' })
      setCurrent('')
      setNext('')
      setStatus({ kind: 'ok', text: done })
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  const on = mode === 'on'
  const busy = status.kind === 'busy'
  const codeInput = (value: string, set: (v: string) => void, placeholder: string) => (
    <input
      className="cc-text"
      type="password"
      inputMode="numeric"
      autoComplete="off"
      maxLength={6}
      value={value}
      placeholder={placeholder}
      onChange={(e) => set(digitsOnly(e.target.value))}
    />
  )

  return (
    <Panel title="SECURITY" tag={<span className={on ? 'cc-live' : 'cc-warn'}>{mode === null ? '…' : on ? 'PASSCODE ON' : 'PASSCODE OFF'}</span>}>
      <p className="cc-note">
        {on
          ? 'He asks for the six-digit passcode every time he starts. Until then he does not listen, answer or show his settings.'
          : 'Anyone at this PC can use him. Set a passcode to lock him at every start.'}
      </p>
      {on && <Field label="CURRENT PASSCODE">{codeInput(current, setCurrent, '••••••')}</Field>}
      <Field label={on ? 'NEW PASSCODE' : 'PASSCODE'} hint="Six digits.">
        {codeInput(next, setNext, '••••••')}
      </Field>
      <div className="cc-inline">
        <button
          className="cc-btn cc-btn-primary"
          disabled={busy || !SIX.test(next) || (on && !SIX.test(current))}
          onClick={() => void run('change', on ? 'Passcode changed.' : 'Passcode on. He asks for it from his next start.')}
        >
          {on ? 'CHANGE' : 'TURN ON'}
        </button>
        {on && (
          <button className="cc-btn" disabled={busy || !SIX.test(current)} onClick={() => void run('remove', 'Passcode off.')}>
            TURN OFF
          </button>
        )}
        {on && (
          <button className="cc-btn" disabled={busy} onClick={() => void lockNow()}>
            LOCK NOW
          </button>
        )}
      </div>
      {status.text && <p className={`cc-note cc-status-${status.kind}`}>{status.text}</p>}
      <p className="cc-note">Forgot it? Close JARVIS and delete passcode.json in the .jarvis folder in your user folder; he asks for a new one at the next start.</p>
    </Panel>
  )
}

function DesktopSection() {
  return (
    <Panel title="DESKTOP">
      <p className="cc-prose">
        Keep JARVIS on the taskbar: while he is open, right-click his icon on the taskbar and choose <b>Pin to taskbar</b>.
        The pinned icon starts him — brain and all — even after a restart.
      </p>
      <p className="cc-prose">
        Closing this window leaves him running by the clock. Right-click the tray icon, or use <b>Stop JARVIS</b> in the Start menu, to quit.
      </p>
    </Panel>
  )
}

export function SettingsPage() {
  return (
    <div className="cc-page-grid cc-grid-3 cc-settings">
      <BridgeSection />
      <KeptSection />
      <LookSection />
      <VoiceSection />
      <SecuritySection />
      <DesktopSection />
    </div>
  )
}
