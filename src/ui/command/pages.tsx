import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { useToolCatalog } from '../../lib/bridge'
import { engineLabel } from '../../lib/capabilities'
import { loadSettings, type SettingsView } from '../../lib/settings'
import { Gauge, Sparkline, Waveform } from './instruments'
import { duration, hhmm, PHASE_LABEL, statsNow, toolName, useActivity, useBridgeStats, useTick } from './data'
import { Num, Panel, Row } from './frame'

/**
 * The deck's other pages. Every reading is real: the bridge's stats, the tool
 * catalogue it announced, and what has actually happened this session.
 */

const ask = (text: string) => window.dispatchEvent(new CustomEvent('jarvis:ask', { detail: text }))
const talk = () => window.dispatchEvent(new CustomEvent('jarvis:talk'))

/** The bridge's settings, for the pages that report them. Re-read on mount. */
function useSettingsView(): SettingsView | null {
  const [view, setView] = useState<SettingsView | null>(null)
  useEffect(() => {
    let live = true
    loadSettings()
      .then((v) => live && setView(v))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return view
}

const PROVIDER_LABEL: Record<string, string> = { openai: 'OpenAI', gemini: 'Google Gemini', vertex: 'Gemini (Vertex)' }

/** A 0–100 history as a filled line, newest on the right. */
function HistoryChart({ values, colour, label }: { values: number[]; colour: string; label: string }) {
  const w = 600
  const h = 140
  const pts = values.length > 1 ? values : [0, 0]
  const step = w / Math.max(1, pts.length - 1)
  const line = pts.map((v, i) => `${(i * step).toFixed(1)},${(h - (Math.min(100, v) / 100) * (h - 8) - 4).toFixed(1)}`).join(' ')
  return (
    <div className="cc-history">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {[25, 50, 75].map((g) => (
          <line key={g} x1="0" x2={w} y1={h - (g / 100) * h} y2={h - (g / 100) * h} className="cc-history-grid" />
        ))}
        <polygon points={`0,${h} ${line} ${w},${h}`} fill={colour} opacity="0.14" />
        <polyline points={line} fill="none" stroke={colour} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="cc-history-label">{label}</span>
    </div>
  )
}

/* ------------------------------------------------------------ intelligence */

export function IntelligencePage({ colour, openSettings }: { colour: string; openSettings: () => void }) {
  const view = useSettingsView()
  const phase = useStore((s) => s.phase)
  const turns = useStore((s) => s.turns)
  const connected = useStore((s) => s.connected)
  const groups = useToolCatalog((s) => s.groups)
  const toolCount = groups.reduce((n, g) => n + g.tools.length, 0)
  const brain = view?.brain

  return (
    <div className="cc-page-grid cc-grid-3">
      <Panel title="NEURAL CORE" tag={<span className={brain?.ready ? 'cc-live' : 'cc-warn'}>{brain ? (brain.ready ? 'READY' : brain.error ? 'FAULT' : 'CHECKING') : '—'}</span>}>
        <div className="cc-core">
          <Waveform color={colour} className="cc-core-wave" bars={48} />
          <div className="cc-rows">
            <Row k="PROVIDER" v={brain ? PROVIDER_LABEL[brain.provider] ?? brain.provider : '—'} live />
            <Row k="MODEL" v={brain?.model ?? '—'} />
            <Row k="STATE" v={PHASE_LABEL[phase]} live={phase !== 'dormant' && phase !== 'offline'} />
            <Row k="MODULES" v={connected.length} />
            <Row k="TOOLS AVAILABLE" v={toolCount || '—'} />
          </div>
        </div>
        {brain?.error && <p className="cc-note cc-warn">{brain.error}</p>}
      </Panel>

      <Panel title="PERSONALITY" tag={<button className="cc-link-btn" onClick={openSettings}>EDIT</button>}>
        <div className="cc-rows">
          <Row k="ADDRESSES YOU AS" v={view?.userName || 'SIR'} live />
        </div>
        <div className="cc-k cc-gap">STANDING INSTRUCTIONS</div>
        <p className="cc-prose">
          {view?.instructions || 'None yet. Add some in Settings — a language to answer in, a tone, things to always or never do.'}
        </p>
      </Panel>

      <Panel title="CAPABILITIES">
        <div className="cc-cap-list">
          {groups.map((g) => (
            <div key={g.group} className="cc-cap">
              <span className="cc-stream-dot" />
              <span>{g.group}</span>
              <b>{g.tools.length}</b>
            </div>
          ))}
          {!groups.length && <div className="cc-dim">Waiting for the bridge…</div>}
        </div>
      </Panel>

      <Panel title="SHORT-TERM MEMORY" className="cc-span-3">
        <div className="cc-memory">
          {turns.slice(-8).map((t) => (
            <div key={t.id} className={`cc-mem cc-mem-${t.role}`}>
              <b>{t.role === 'user' ? 'YOU' : 'JARVIS'}</b>
              <span>{t.text || '…'}</span>
            </div>
          ))}
          {!turns.length && <div className="cc-dim">Nothing said yet this session.</div>}
        </div>
      </Panel>
    </div>
  )
}

/* ----------------------------------------------------------------- systems */

export function SystemsPage({ colour }: { colour: string }) {
  const { stats, online, latency, cpuHistory } = useBridgeStats()
  const view = useSettingsView()
  const connected = useStore((s) => s.connected)
  const gpu = stats?.gpu

  return (
    <div className="cc-page-grid cc-grid-2">
      <Panel title="HARDWARE">
        <div className="cc-gauges">
          <Gauge value={stats?.cpu ?? null} label="CPU" color={colour} />
          <Gauge value={gpu?.util ?? null} label="GPU" color={colour} />
          <Gauge value={stats?.ram ?? null} label="RAM" color={colour} />
          <Gauge value={stats?.disk ?? null} label="STORAGE" color={colour} />
        </div>
        <div className="cc-cols-2">
          <div className="cc-rows">
            <Row k="CORES" v={stats?.cores ?? '—'} />
            <Row k="MEMORY" v={stats ? `${stats.ramTotalGb} GB` : '—'} />
            <Row k="PC UPTIME" v={stats ? duration(stats.uptime) : '—'} />
          </div>
          <div className="cc-rows">
            <Row k="GRAPHICS" v={gpu?.name?.replace(/NVIDIA |GeForce |AMD |Radeon /g, '') ?? '—'} />
            <Row k="GPU TEMP" v={gpu?.temp != null ? `${gpu.temp}°C` : '—'} />
            <Row k="VIDEO MEMORY" v={gpu?.memory != null ? `${gpu.memory}%` : '—'} />
          </div>
        </div>
      </Panel>

      <Panel title="PROCESSOR LOAD" tag={<span className="cc-live">{stats ? `${stats.cpu}%` : '—'}</span>}>
        <HistoryChart values={cpuHistory} colour={colour} label="LAST 2 MINUTES" />
      </Panel>

      <Panel title="BRIDGE LINK" tag={<span className={online ? 'cc-live' : 'cc-warn'}>{online ? 'ONLINE' : 'DOWN'}</span>}>
        <div className="cc-rows">
          <Row k="LATENCY" v={<Num value={latency} suffix=" ms" />} />
          <Row k="BRIDGE UPTIME" v={stats ? duration(stats.bridgeUptime) : '—'} />
          <Row k="PLATFORM" v={view?.platform === 'win32' ? 'WINDOWS' : (view?.platform ?? '—').toUpperCase()} />
        </div>
        <div className="cc-k cc-gap">MODULES ONLINE</div>
        <div className="cc-cap-list">
          {connected.map((m) => (
            <div key={m} className="cc-cap">
              <span className="cc-stream-dot" />
              <span>{m}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="PERMISSIONS">
        <div className="cc-rows">
          <Row k="PC CONTROL" v={view ? (view.pcControl ? 'ON' : 'OFF') : '—'} live={view?.pcControl} />
          <Row k="COMMANDS" v={view ? (view.commands ? 'ON' : 'OFF') : '—'} live={view?.commands} />
          <Row k="RISKY ACTIONS" v="ALWAYS ASK YOU" live />
          <Row k="API KEYS" v="SERVER-SIDE ONLY" />
        </div>
        <p className="cc-note">
          Deleting, sending, buying, running commands and clicking always wait for your yes. That cannot be switched off.
        </p>
      </Panel>
    </div>
  )
}

/* --------------------------------------------------------------- analytics */

export function AnalyticsPage({ colour }: { colour: string }) {
  const activity = useActivity()
  const { cpuHistory } = useBridgeStats()
  useTick(1000)
  const session = Math.round((Date.now() - activity.startedAt) / 1000)
  const usage = Object.entries(activity.toolCounts).sort((a, b) => b[1] - a[1])
  const most = usage[0]?.[1] ?? 1
  const answers = activity.items.filter((a) => a.text.startsWith('Answered')).length

  return (
    <div className="cc-page-grid cc-grid-2">
      <Panel title="SESSION">
        <div className="cc-stat-tiles">
          <div><b><Num value={activity.turns} /></b><span>QUESTIONS</span></div>
          <div><b><Num value={activity.tools} /></b><span>TOOLS RUN</span></div>
          <div><b><Num value={activity.words} /></b><span>WORDS SPOKEN</span></div>
          <div><b>{duration(session)}</b><span>SESSION</span></div>
          <div><b><Num value={answers ? Math.round(activity.words / answers) : 0} /></b><span>WORDS / ANSWER</span></div>
          <div><b><Num value={usage.length} /></b><span>DIFFERENT TOOLS</span></div>
        </div>
      </Panel>

      <Panel title="TOOL USAGE">
        <div className="cc-usage">
          {usage.map(([name, n]) => (
            <div key={name} className="cc-usage-row">
              <span className="cc-k">{name}</span>
              <span className="cc-usage-bar"><span style={{ width: `${(n / most) * 100}%` }} /></span>
              <b>{n}</b>
            </div>
          ))}
          {!usage.length && <div className="cc-dim">No tools used yet this session.</div>}
        </div>
      </Panel>

      <Panel title="SYSTEM LOAD TREND">
        <HistoryChart values={cpuHistory} colour={colour} label="PROCESSOR %" />
        <div className="cc-k cc-gap">MEMORY</div>
        <Sparkline color={colour} className="cc-trend-line" value={() => (statsNow().stats?.ram ?? 0) / 100} />
      </Panel>

      <Panel title="ACTIVITY LOG">
        <div className="cc-log-list">
          {activity.items.map((a) => (
            <div key={a.id} className="cc-act">
              <span className="cc-act-time">{hhmm(a.at)}</span>
              <span className="cc-act-text">{a.text}</span>
            </div>
          ))}
          {!activity.items.length && <div className="cc-dim">Nothing yet — say “Hey Jarvis”.</div>}
        </div>
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------- tools */

export function ToolsPage() {
  const groups = useToolCatalog((s) => s.groups)
  const counts = useActivity((s) => s.toolCounts)
  const [filter, setFilter] = useState('')
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return groups
      .map((g) => ({
        ...g,
        tools: g.tools.filter((t) => !q || `${t.name} ${t.summary} ${g.group}`.toLowerCase().includes(q)),
      }))
      .filter((g) => g.tools.length)
  }, [groups, filter])

  return (
    <div className="cc-page-grid cc-grid-1">
      <Panel
        title={`TOOL ARSENAL · ${groups.reduce((n, g) => n + g.tools.length, 0)} TOOLS`}
        tag={<input className="cc-search" placeholder="Search tools…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      >
        <div className="cc-tool-groups">
          {shown.map((g) => (
            <section key={g.group} className="cc-tool-group">
              <h3>{g.group}</h3>
              {g.tools.map((t) => (
                <div key={t.name} className="cc-tool">
                  <b>{toolName(t.name)}</b>
                  <span>{t.summary}</span>
                  <i className={t.asks ? 'cc-asks' : 'cc-direct'}>{t.asks ? 'ASKS YOU FIRST' : 'RUNS DIRECTLY'}</i>
                  {counts[toolName(t.name)] ? <em>{counts[toolName(t.name)]}×</em> : null}
                </div>
              ))}
            </section>
          ))}
          {!groups.length && <div className="cc-dim">The bridge has not announced its tools yet.</div>}
        </div>
      </Panel>
    </div>
  )
}

/* ----------------------------------------------------------- communication */

export function CommunicationPage({ colour }: { colour: string }) {
  const turns = useStore((s) => s.turns)
  const phase = useStore((s) => s.phase)
  const caption = useStore((s) => s.caption)
  const voice = useStore((s) => s.voice)
  const [draft, setDraft] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const awake = phase !== 'offline' && phase !== 'boot'

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [turns])

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    ask(text)
    setDraft('')
  }

  return (
    <div className="cc-page-grid cc-grid-chat">
      <Panel title="CONVERSATION" className="cc-chat-panel" tag={<span className="cc-live">{PHASE_LABEL[phase]}</span>}>
        <div className="cc-chat">
          {turns.map((t) => (
            <div key={t.id} className={`cc-bubble cc-bubble-${t.role}`}>
              <b>{t.role === 'user' ? 'YOU' : 'JARVIS'}</b>
              <p>{t.text || '…'}</p>
              {t.tools?.length ? <i>used {t.tools.map(toolName).join(', ')}</i> : null}
            </div>
          ))}
          {!turns.length && <div className="cc-dim">Say “Hey Jarvis”, press Space, or type below.</div>}
          <div ref={end} />
        </div>
        <div className="cc-chat-input">
          <input
            className="cc-input"
            value={draft}
            placeholder={awake ? 'Type to JARVIS…' : 'Power up to begin'}
            disabled={!awake}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') setDraft('')
            }}
          />
          <button className="cc-btn" onClick={submit} disabled={!awake || !draft.trim()}>SEND</button>
          <button className={`cc-btn ${phase === 'listening' ? 'on' : ''}`} onClick={talk} disabled={!awake}>TALK</button>
        </div>
      </Panel>

      <Panel title="VOICE CHANNEL">
        <Waveform color={colour} className="cc-audio-wave" bars={40} />
        <div className="cc-rows">
          <Row k="STATUS" v={PHASE_LABEL[phase]} live={phase === 'listening' || phase === 'speaking'} />
          <Row k="WAKE WORD" v="HEY JARVIS" />
          <Row k="SPEECH" v={engineLabel().toUpperCase()} />
          <Row k="VOICE" v={(voice || 'BROWSER').replace(/\(.*?\)/g, '').replace(/^(Google|Microsoft) /, '').trim()} />
          <Row k="PUSH TO TALK" v="SPACE" />
        </div>
        {caption && <p className="cc-note cc-live">“{caption}”</p>}
      </Panel>
    </div>
  )
}
