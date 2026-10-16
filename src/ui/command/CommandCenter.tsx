import { useEffect, useRef, useState } from 'react'
import { REACTOR_LAYOUT } from '../../config'
import { useStore, type Phase } from '../../store'
import { DecodeText } from '../DecodeText'
import { Bars, FlatMap, Gauge, Globe, PolyOrb, Sparkline, Terrain, Waveform } from './instruments'
import { duration, hhmm, PHASE_LABEL, statsNow, toolName, useActivity, useActivityRecorder, useBridgeStats, useTick } from './data'
import { Num, Panel, Row } from './frame'
import { AnalyticsPage, CommunicationPage, IntelligencePage, SystemsPage, ToolsPage } from './pages'
import { SettingsPage } from './Settings'
import { SecureAccess } from './SecureAccess'
import { useLock } from '../../lib/lock'
import './command.css'

/**
 * The command centre: JARVIS's whole interface as a holographic operations
 * deck. Every panel animates, and wherever there is a real number to show —
 * processor, memory, graphics card, weather, what he is doing and has done —
 * it is the real number. The reactor ring (the 3D scene behind this) frames
 * the globe at the centre and still breathes with his voice.
 */

const ask = (text: string) => window.dispatchEvent(new CustomEvent('jarvis:ask', { detail: text }))
const talk = () => window.dispatchEvent(new CustomEvent('jarvis:talk'))

/** A bar that wanders around a level, so "running" looks like work. */
function Meter({ active, base = 0 }: { active: boolean; base?: number }) {
  useTick(900)
  const v = active ? 35 + Math.random() * 60 : base + Math.random() * 3
  return (
    <span className="cc-meter">
      <span style={{ width: `${v}%` }} />
    </span>
  )
}

/* --------------------------------------------------------------- top bar */

function Clock() {
  useTick(1000)
  const now = new Date()
  return (
    <div className="cc-clock">
      <div className="cc-clock-time">{now.toTimeString().slice(0, 8)}</div>
      <div className="cc-clock-date">
        {now.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase()}
      </div>
    </div>
  )
}

const TABS = ['OVERVIEW', 'INTELLIGENCE', 'SYSTEMS', 'ANALYTICS', 'TOOLS', 'COMMUNICATION', 'SETTINGS'] as const
type Tab = (typeof TABS)[number]

function TopBar({
  colour,
  online,
  tab,
  setTab,
  locked,
}: {
  colour: string
  online: boolean
  tab: Tab
  setTab: (t: Tab) => void
  locked: boolean
}) {
  return (
    <header className="cc-top">
      <Clock />
      <div className="cc-brand">
        <svg className="cc-logo" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="17" />
          <circle cx="20" cy="20" r="11" />
          <path d="M20 3 V11 M20 29 V37 M3 20 H11 M29 20 H37" />
        </svg>
        <div>
          <div className="cc-brand-name">J.A.R.V.I.S.</div>
          <div className="cc-brand-sub">YOUR INTELLIGENCE INTERFACE</div>
        </div>
      </div>
      <nav className="cc-nav">
        {locked && <button className="on">SECURE ACCESS</button>}
        {TABS.map((t) => (
          <button key={t} className={t === tab && !locked ? 'on' : ''} disabled={locked} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      <div className="cc-link">
        <Globe color={colour} className="cc-link-globe" density={6} satellites={0} speed={30} tilt={10} />
        <div>
          <div className={online ? 'cc-online' : 'cc-offline'}>{online ? 'ONLINE' : 'LINK LOST'}</div>
          <div className="cc-link-sub">{online ? 'GLOBAL LINK ESTABLISHED' : 'RECONNECTING TO BRIDGE'}</div>
        </div>
        <span className="cc-dots">
          <b />
          <b />
          <b />
        </span>
      </div>
    </header>
  )
}

/* ----------------------------------------------------------------- left */

function LeftColumn({ colour }: { colour: string }) {
  const { stats, latency, online } = useBridgeStats()
  const connected = useStore((s) => s.connected)
  const confirm = useStore((s) => s.confirm)
  const error = useStore((s) => s.error)
  const phase = useStore((s) => s.phase)
  const activity = useActivity()

  const streams: [string, string, (() => number) | undefined][] = [
    ['PROCESSOR', 'LIVE', () => (statsNow().stats?.cpu ?? 0) / 100],
    ['MEMORY', 'LIVE', () => (statsNow().stats?.ram ?? 0) / 100],
    ['GRAPHICS', 'LIVE', () => (statsNow().stats?.gpu?.util ?? 0) / 100],
    ['MICROPHONE', 'LIVE', () => useStore.getState().level],
    ['VOICE OUT', phase === 'speaking' ? 'LIVE' : 'SYNC', undefined],
    ['BRIDGE LINK', online ? 'LIVE' : 'DOWN', undefined],
    ['AI MODEL', 'SYNC', undefined],
    ['WEB ACCESS', 'SYNC', undefined],
  ]

  return (
    <aside className="cc-col cc-left">
      <Panel title="WORLD VIEW" className="cc-world" delay={100}>
        <div className="cc-world-grid">
          <Globe color={colour} className="cc-world-globe" pulse={() => useStore.getState().level} />
          <div className="cc-rows">
            <Row k="MODULES" v={<Num value={connected.length + 1} />} live />
            <Row k="CORES" v={<Num value={stats?.cores} />} live />
            <Row k="MEMORY" v={stats ? `${stats.ramTotalGb} GB` : '—'} live />
            <Row k="SYSTEM LOAD" v={<Num value={stats?.cpu} suffix="%" />} />
            <Row k="LATENCY" v={<Num value={latency} suffix=" ms" />} />
            <FlatMap color={colour} className="cc-world-map" pings={5} />
          </div>
        </div>
      </Panel>

      <Panel title="SECURITY ANALYSIS" className="cc-threat" delay={200}>
        <div className="cc-split">
          <FlatMap color={colour} className="cc-threat-map" />
          <div className="cc-rows">
            <Row k="PENDING APPROVALS" v={confirm ? 1 : 0} />
            <Row k="ACTIVE ALERTS" v={<span className={error ? 'cc-warn' : ''}>{error ? 1 : 0}</span>} />
            <Row k="KEYS EXPOSED" v={0} />
            <Row k="CONFIRMATION" v="ALWAYS" />
            <Row k="SYSTEM INTEGRITY" v={<Num value={error ? 92 : 100} suffix="%" />} live />
          </div>
        </div>
      </Panel>

      <Panel title="MISSION PARAMETERS" className="cc-mission" delay={300}>
        <div className="cc-mission-grid">
          <span className="cc-k">PRIMARY</span>
          <span className="cc-v">ASSIST AND OPTIMIZE</span>
          <span className="cc-progress"><span style={{ width: '82%' }} /></span>
          <span className="cc-k">SECONDARY</span>
          <span className="cc-v">MONITOR SYSTEMS</span>
          <span className="cc-progress"><span style={{ width: '64%' }} /></span>
          <span className="cc-k">STATUS</span>
          <span className="cc-v cc-live">{PHASE_LABEL[phase]}</span>
          <span className="cc-progress cc-progress-run"><span /></span>
        </div>
      </Panel>

      <Panel title="DATA STREAMS" className="cc-streams" delay={400}>
        <div className="cc-stream-list">
          {streams.map(([name, state, value], i) => (
            <div key={name} className="cc-stream">
              <span className="cc-stream-dot" />
              <span className="cc-k">{name}</span>
              <span className={`cc-stream-state ${state === 'DOWN' ? 'cc-warn' : ''}`}>{state}</span>
              <Sparkline color={colour} value={value} seed={i * 1.7} className="cc-stream-line" fill={false} />
            </div>
          ))}
        </div>
        <div className="cc-foot">
          <span>STREAMS {online ? 8 : 7}/8</span>
          <span>TURNS {activity.turns}</span>
          <span>UPTIME {stats ? duration(stats.uptime) : '—'}</span>
        </div>
      </Panel>
    </aside>
  )
}

/* --------------------------------------------------------------- centre */

const LEFT_CHIPS: [string, (p: Phase, extra: { looking: boolean }) => boolean][] = [
  ['NLP', (p) => p === 'speaking'],
  ['VISION', (_, x) => x.looking],
  ['AUDIO', (p) => p === 'listening' || p === 'waking'],
  ['REASONING', (p) => p === 'thinking'],
]
const RIGHT_CHIPS: [string, (p: Phase) => boolean][] = [
  ['PLANNING', (p) => p === 'thinking'],
  ['TOOLS', (p) => p === 'tooling'],
  ['MEMORY', (p) => p === 'thinking' || p === 'speaking'],
  ['LEARNING', () => false],
]

const ACTIONS: [string, string, string][] = [
  ['ANALYZE', 'DATA & TRENDS', 'Analyze '],
  ['RESEARCH', 'FIND & SUMMARIZE', 'Research '],
  ['PLAN', 'STRATEGIZE', 'Plan '],
  ['CREATE', 'GENERATE & BUILD', 'Create '],
  ['AUTOMATE', 'EXECUTE TASKS', 'On my PC, '],
]

function ActionIcon({ i }: { i: number }) {
  const paths = [
    'M4 18 L9 12 L13 15 L20 6 M15 6 H20 V11',
    'M10 4 A6 6 0 1 1 10 16 A6 6 0 1 1 10 4 M15 15 L20 20',
    'M4 6 H20 M4 12 H14 M4 18 H17 M18 10 L21 13 L18 16',
    'M12 3 L14.5 9.5 L21 12 L14.5 14.5 L12 21 L9.5 14.5 L3 12 L9.5 9.5 Z',
    'M12 8 A4 4 0 1 1 12 16 A4 4 0 1 1 12 8 M12 2 V6 M12 18 V22 M2 12 H6 M18 12 H22 M5 5 L8 8 M16 16 L19 19 M19 5 L16 8 M8 16 L5 19',
  ]
  return (
    <svg viewBox="0 0 24 24" className="cc-action-icon">
      <path d={paths[i]} />
    </svg>
  )
}

function Centre({ colour }: { colour: string }) {
  const phase = useStore((s) => s.phase)
  const caption = useStore((s) => s.caption)
  const turns = useStore((s) => s.turns)
  const looking = useStore((s) => Boolean(s.looking) || s.gestures)
  const activeTool = useStore((s) => s.activeTool)
  const error = useStore((s) => s.error)
  const level = useStore((s) => s.level)
  const items = useActivity((s) => s.items)
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')

  const lastJarvis = [...turns].reverse().find((t) => t.role === 'jarvis')
  const busy = phase === 'thinking' || phase === 'tooling'
  const awake = phase !== 'offline' && phase !== 'boot'

  const processes: [string, boolean, string][] = [
    ['Natural Language Processing', phase === 'speaking', ''],
    ['Speech Recognition', phase === 'listening' || phase === 'waking', phase === 'dormant' ? 'STANDBY' : ''],
    ['Reasoning', phase === 'thinking', ''],
    ['Tool Execution', phase === 'tooling', activeTool ? toolName(activeTool) : ''],
    ['Computer Vision', looking, ''],
    ['PC Control', phase === 'tooling' && /pc|window|key|type|volume|command|power|mouse/i.test(activeTool ?? ''), ''],
  ]

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    ask(text)
    setDraft('')
  }

  return (
    <main className="cc-center">
      <div className="cc-center-top">
        <div className="cc-init">
          <span>{PHASE_LABEL[phase]}</span>
          <span className="cc-progress cc-progress-run"><span /></span>
        </div>
        <div className="cc-nominal">
          <span className={error ? 'cc-warn' : ''}>{error ? 'ATTENTION REQUIRED' : 'ALL SYSTEMS NOMINAL'}</span>
          <span className="cc-progress"><span style={{ width: error ? '40%' : '100%' }} /></span>
        </div>
      </div>

      <div className="cc-stage">
        <svg className="cc-rings" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="98" className="cc-ring cc-ring-a" />
          <circle cx="100" cy="100" r="93" className="cc-ring cc-ring-b" />
          <circle cx="100" cy="100" r="86" className="cc-ring cc-ring-c" />
          <circle cx="100" cy="100" r="66" className="cc-ring cc-ring-d" />
          <path d="M100 0 V8 M100 192 V200 M0 100 H8 M192 100 H200" className="cc-ring-cross" />
        </svg>
        <Globe
          color={colour}
          className="cc-stage-globe"
          density={2.2}
          speed={busy ? 26 : 9}
          satellites={4}
          pulse={() => useStore.getState().level}
        />
      </div>

      <div className="cc-chips cc-chips-left">
        {LEFT_CHIPS.map(([name, on]) => (
          <div key={name} className={`cc-chip ${awake && on(phase, { looking }) ? 'on' : ''}`}>
            <b>{name}</b>
            <span>{awake ? (on(phase, { looking }) ? 'ACTIVE' : 'ONLINE') : 'OFFLINE'}</span>
          </div>
        ))}
      </div>
      <div className="cc-chips cc-chips-right">
        {RIGHT_CHIPS.map(([name, on]) => (
          <div key={name} className={`cc-chip ${awake && on(phase) ? 'on' : ''}`}>
            <b>{name}</b>
            <span>{awake ? (on(phase) ? 'ACTIVE' : 'ONLINE') : 'OFFLINE'}</span>
          </div>
        ))}
      </div>

      <div className="cc-console">
        <i className="cc-c cc-c-tl" />
        <i className="cc-c cc-c-tr" />
        <i className="cc-c cc-c-bl" />
        <i className="cc-c cc-c-br" />
        <Waveform color={colour} className="cc-console-wave" bars={90} />
        <div className="cc-console-line">
          {caption ? (
            <span className="cc-heard">{caption}</span>
          ) : lastJarvis?.text && phase !== 'dormant' ? (
            <DecodeText text={lastJarvis.text} />
          ) : (
            'How can I help you today?'
          )}
        </div>
        <input
          ref={input}
          className="cc-input"
          value={draft}
          placeholder={awake ? 'Type to JARVIS, or say “Hey Jarvis”…' : 'Power up to begin'}
          disabled={!awake}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') setDraft('')
          }}
        />
      </div>

      <div className="cc-actions">
        {ACTIONS.map(([name, sub, starter], i) => (
          <button
            key={name}
            className="cc-action"
            style={{ ['--d' as string]: `${600 + i * 80}ms` }}
            onClick={() => {
              setDraft(starter)
              requestAnimationFrame(() => input.current?.focus())
            }}
          >
            <ActionIcon i={i} />
            <b>{name}</b>
            <span>{sub}</span>
          </button>
        ))}
      </div>

      <button
        className={`cc-mic ${phase === 'listening' ? 'live' : ''}`}
        style={{ ['--lvl' as string]: String(level) }}
        onClick={talk}
        title="Talk (Space)"
      >
        <svg viewBox="0 0 24 24">
          <path d="M12 3 A3 3 0 0 1 15 6 V12 A3 3 0 0 1 9 12 V6 A3 3 0 0 1 12 3 Z M6 11 A6 6 0 0 0 18 11 M12 17 V21 M9 21 H15" />
        </svg>
      </button>

      <div className="cc-lower">
        <Panel title="ACTIVE PROCESSES" className="cc-procs" delay={700}>
          {processes.map(([name, on, note]) => (
            <div key={name} className="cc-proc">
              <span className="cc-proc-name">{name}</span>
              <span className={`cc-proc-state ${on ? 'cc-live' : ''}`}>{on ? 'RUNNING' : note || (awake ? 'READY' : 'IDLE')}</span>
              <Meter active={on} base={awake ? 4 : 0} />
            </div>
          ))}
        </Panel>
        <Panel title="RECENT ACTIVITY" className="cc-activity" delay={800}>
          {items.length === 0 && <div className="cc-dim">Nothing yet — say “Hey Jarvis”.</div>}
          {items.slice(0, 7).map((a) => (
            <div key={a.id} className="cc-act">
              <span className="cc-act-time">{hhmm(a.at)}</span>
              <span className="cc-act-text">{a.text}</span>
            </div>
          ))}
        </Panel>
      </div>
    </main>
  )
}

/* ---------------------------------------------------------------- right */

function RightColumn({ colour }: { colour: string }) {
  const { stats } = useBridgeStats()
  const phase = useStore((s) => s.phase)
  const level = useStore((s) => s.level)
  const voice = useStore((s) => s.voice)
  const activity = useActivity()
  useTick(1000)
  const w = stats?.weather
  const gpu = stats?.gpu
  const db = (v: number) => (v > 0.001 ? Math.max(-60, Math.round(20 * Math.log10(v))) : -60)
  const session = Math.round((Date.now() - activity.startedAt) / 1000)

  return (
    <aside className="cc-col cc-right">
      <Panel title="SYSTEM DIAGNOSTICS" className="cc-diag" delay={150}>
        <div className="cc-gauges">
          <Gauge value={stats?.cpu ?? null} label="CPU" color={colour} />
          <Gauge value={gpu?.util ?? null} label="GPU" color={colour} />
          <Gauge value={stats?.ram ?? null} label="RAM" color={colour} />
          <Gauge value={stats?.disk ?? null} label="STORAGE" color={colour} />
        </div>
        <div className="cc-split">
          <Sparkline
            color={colour}
            className="cc-heartbeat"
            value={() => {
              const h = statsNow().cpuHistory
              return (h[h.length - 1] ?? 0) / 100 + Math.sin(performance.now() / 90) * 0.04
            }}
          />
          <div className="cc-rows">
            <Row k="GPU TEMP" v={gpu?.temp != null ? `${gpu.temp}°C` : '—'} />
            <Row k="POWER DRAW" v={gpu?.power != null ? `${Math.round(gpu.power)} W` : '—'} />
            <Row k="FAN SPEED" v={gpu?.fan != null ? `${gpu.fan}%` : '—'} />
            <Row k="VIDEO MEMORY" v={gpu?.memory != null ? `${gpu.memory}%` : '—'} />
          </div>
        </div>
      </Panel>

      <Panel title="LIVE SENSORS" className="cc-sensors" delay={250}>
        <div className="cc-split">
          <Terrain color={colour} className="cc-terrain" />
          <div className="cc-rows">
            <Row k="ATMOSPHERE" v={w ? 'STABLE' : '—'} />
            <Row k="WEATHER" v={w?.sky ?? 'SET CITY'} live={Boolean(w)} />
            <Row k="TEMP" v={w ? `${w.temp}°C` : '—'} />
            <Row k="HUMIDITY" v={w ? `${w.humidity}%` : '—'} />
            <Row k="WIND" v={w ? `${w.wind} km/h` : '—'} />
          </div>
        </div>
      </Panel>

      <Panel title="AUDIO MONITOR" className="cc-audio" delay={350}>
        <div className="cc-split">
          <Waveform color={colour} className="cc-audio-wave" bars={56} />
          <div className="cc-rows">
            <Row k="INPUT" v={`${phase === 'speaking' ? -60 : db(level)} dB`} />
            <Row k="OUTPUT" v={`${phase === 'speaking' ? db(level) : -60} dB`} />
            <Row k="VOICE" v={phase === 'speaking' ? 'ACTIVE' : 'READY'} live={phase === 'speaking'} />
            <Row k="ENGINE" v={(voice || 'BROWSER').replace(/\(.*?\)/g, '').replace(/^Google /, '').trim().slice(0, 14)} />
            <Row k="MODE" v={phase === 'dormant' || phase === 'offline' ? 'STANDBY' : 'CONVERSATION'} />
          </div>
        </div>
      </Panel>

      <Panel title="HOLOGRAPHIC ANALYTICS" className="cc-holo" delay={450}>
        <div className="cc-holo-grid">
          <Bars color={colour} className="cc-holo-bars" />
          <div className="cc-holo-line">
            <Sparkline color={colour} seed={4.2} />
            <div className="cc-rows">
              <Row k="QUESTIONS" v={<Num value={activity.turns} />} live />
              <Row k="TOOLS USED" v={<Num value={activity.tools} />} live />
            </div>
          </div>
          <div className="cc-holo-bottom">
            <PolyOrb color={colour} className="cc-holo-orb" />
            <div className="cc-rows cc-holo-stats">
              <Row k="WORDS SPOKEN" v={<Num value={activity.words} />} />
              <Row k="SESSION" v={duration(session)} />
              <Row k="BRIDGE UP" v={stats ? duration(stats.bridgeUptime) : '—'} />
              <Row k="STABILITY" v={<Num value={99.9} digits={1} suffix="%" />} />
            </div>
            <PolyOrb color={colour} kind="ring" className="cc-holo-orb" />
          </div>
        </div>
      </Panel>
    </aside>
  )
}

/* ---------------------------------------------------------------- footer */

function BottomBar({ online }: { online: boolean }) {
  const phase = useStore((s) => s.phase)
  const turns = useStore((s) => s.turns.length)
  const { stats } = useBridgeStats()
  useTick(1000)
  const w = stats?.weather
  const state = phase === 'listening' || phase === 'waking' ? 'l' : phase === 'thinking' || phase === 'tooling' ? 't' : 'r'
  return (
    <footer className="cc-bottom">
      <div className="cc-bottom-left">
        <span className="cc-spinner" />
        <span>AWARENESS<b className="cc-live">{phase === 'offline' ? 'OFF' : 'ACTIVE'}</b></span>
        <span>CONTEXT<b>{Math.min(100, Math.round((turns / 40) * 100))}%</b></span>
        <span>USER<b className={online ? 'cc-live' : 'cc-warn'}>{online ? 'LINKED' : 'OFFLINE'}</b></span>
        <span>PRIVACY<b>SECURED</b></span>
      </div>
      <div className="cc-states">
        <span className="cc-eq"><b /><b /><b /><b /></span>
        <span className={state === 'l' ? 'on' : ''}>LISTENING</span>
        <span className={state === 't' ? 'on' : ''}>THINKING</span>
        <span className={state === 'r' ? 'on' : ''}>READY</span>
      </div>
      <div className="cc-bottom-right">
        <span>LOCAL TIME<b>{hhmm(new Date())}</b></span>
        {w && (
          <span>
            {w.lat.toFixed(4)}° {w.lat >= 0 ? 'N' : 'S'} · {Math.abs(w.lon).toFixed(4)}° {w.lon >= 0 ? 'E' : 'W'}
          </span>
        )}
        <span className="cc-weather">{w ? `${w.sky} ${w.temp}°C` : 'NO CITY SET'}</span>
      </div>
    </footer>
  )
}

/* ------------------------------------------------------------------ deck */

function Page({ tab, colour, go }: { tab: Tab; colour: string; go: (t: Tab) => void }) {
  return (
    <div className="cc-page" key={tab}>
      {tab === 'INTELLIGENCE' && <IntelligencePage colour={colour} openSettings={() => go('SETTINGS')} />}
      {tab === 'SYSTEMS' && <SystemsPage colour={colour} />}
      {tab === 'ANALYTICS' && <AnalyticsPage colour={colour} />}
      {tab === 'TOOLS' && <ToolsPage />}
      {tab === 'COMMUNICATION' && <CommunicationPage colour={colour} />}
      {tab === 'SETTINGS' && <SettingsPage />}
    </div>
  )
}

export function CommandCenter({ colour }: { colour: string }) {
  const phase = useStore((s) => s.phase)
  const { online } = useBridgeStats()
  const [tab, setTab] = useState<Tab>('OVERVIEW')
  const locked = useLock((s) => s.locked)
  useActivityRecorder()

  useEffect(() => {
    document.documentElement.classList.add('command-hud')
    return () => document.documentElement.classList.remove('command-hud')
  }, [])

  // On the other pages the reactor steps back behind them rather than glowing
  // through. The lock screen is built around it, so there it stays lit.
  useEffect(() => {
    document.documentElement.classList.toggle('cc-paged', tab !== 'OVERVIEW' && !locked)
  }, [tab, locked])

  return (
    <div
      className={`cc ${phase === 'offline' ? 'cc-dark' : 'cc-on'}`}
      style={{ ['--fit' as string]: String(REACTOR_LAYOUT.fit), ['--cy' as string]: `${REACTOR_LAYOUT.top * 100}vh` }}
    >
      <div className="cc-grid-bg" />
      <TopBar colour={colour} online={online} tab={tab} setTab={setTab} locked={locked} />
      {locked ? (
        <SecureAccess colour={colour} />
      ) : tab === 'OVERVIEW' ? (
        <>
          <LeftColumn colour={colour} />
          <Centre colour={colour} />
          <RightColumn colour={colour} />
        </>
      ) : (
        <Page tab={tab} colour={colour} go={setTab} />
      )}
      <BottomBar online={online} />
    </div>
  )
}
