import { useCallback, useEffect, useRef, useState } from 'react'
import { granted, lockStatus, passcode, type LockStatus } from '../../lib/lock'
import { useStore } from '../../store'
import { Bars, FlatMap, Gauge, Globe, Sparkline } from './instruments'
import { duration, statsNow, useBridgeStats, useTick } from './data'
import { Num, Panel, Row } from './frame'

/**
 * The passcode screen. It replaces the deck until the bridge accepts the code;
 * nothing listens and nothing answers before then (App.tsx waits on it).
 *
 * There is no ENTER and no CLEAR key on purpose: the sixth digit submits, and
 * Backspace (or a tap on the code boxes) takes the last digit back.
 */

const LENGTH = 6
type Stage = 'connecting' | 'enter' | 'create' | 'confirm'
type Note = { text: string; tone: 'info' | 'bad' | 'good' }

const PROMPT: Record<Stage, string> = {
  connecting: 'CONNECTING TO BRIDGE',
  enter: 'ENTER PASSCODE',
  create: 'CREATE A 6-DIGIT PASSCODE',
  confirm: 'CONFIRM PASSCODE',
}

const time = (at: number) => new Date(at).toTimeString().slice(0, 8)

function LockIcon() {
  return (
    <svg className="sa-lock" viewBox="0 0 24 24">
      <path d="M8 11 V7.5 A4 4 0 0 1 16 7.5 V11" />
      <rect x="5" y="11" width="14" height="10" rx="1.6" />
      <path d="M12 15 V17.5" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg className="sa-shield" viewBox="0 0 24 24">
      <path d="M12 2.5 L20 5.5 V11 C20 16 16.6 19.6 12 21.5 C7.4 19.6 4 16 4 11 V5.5 Z" />
      <path d="M8.5 12 L11 14.5 L15.5 9.5" />
    </svg>
  )
}

function Fingerprint({ scanning }: { scanning: boolean }) {
  return (
    <div className={`sa-print ${scanning ? 'scan' : ''}`}>
      <svg viewBox="0 0 48 48">
        <path d="M10 17 A16 16 0 0 1 38 17" />
        <path d="M7 25 A17 17 0 0 1 41 24 V27" />
        <path d="M13 40 A13 13 0 0 1 11 26 A13 13 0 0 1 37 26 V30 A6 6 0 0 1 33 36" />
        <path d="M18 43 A11 11 0 0 1 16.5 28 A7.5 7.5 0 0 1 31.5 28 V32" />
        <path d="M24 28 V33 A10 10 0 0 0 28.5 43" />
        <path d="M23 45 A17 17 0 0 1 20.5 34" />
      </svg>
      <span className="sa-print-scan" />
    </div>
  )
}

/* ----------------------------------------------------------------- left */

function LeftSide({ colour, status }: { colour: string; status: LockStatus | null }) {
  const { stats, online } = useBridgeStats()
  const [opened] = useState(() => Date.now())
  const waiting = (status?.waitMs ?? 0) > 0
  const failures = status?.failures ?? 0
  const threat = waiting ? 'HIGH' : failures > 0 ? 'ELEVATED' : 'LOW'

  type Entry = [at: string, what: string, ok: boolean]
  const log: Entry[] = [
    ...(status?.log ?? [])
      .slice()
      .reverse()
      .map((e): Entry => [time(e.at), e.ok ? 'ACCESS GRANTED' : 'ACCESS DENIED', e.ok]),
    [time(opened), 'SECURITY SCREEN UP', true] as Entry,
  ].slice(0, 7)

  const streams: [string, () => number][] = [
    ['PROCESSOR', () => (statsNow().stats?.cpu ?? 0) / 100],
    ['MEMORY', () => (statsNow().stats?.ram ?? 0) / 100],
    ['GRAPHICS', () => (statsNow().stats?.gpu?.util ?? 0) / 100],
    ['STORAGE', () => (statsNow().stats?.disk ?? 0) / 100],
  ]
  const values = [stats?.cpu, stats?.ram, stats?.gpu?.util, stats?.disk]

  return (
    <aside className="cc-col cc-left">
      <Panel title="SYSTEM STATUS" className="sa-status" delay={100}>
        <div className="cc-world-grid">
          <Globe color={colour} className="cc-world-globe" density={2.4} satellites={2} />
          <div className="cc-rows">
            <Row k="CORE SYSTEMS" v={online ? 'ONLINE' : 'OFFLINE'} live={online} />
            <Row k="AI ENGINE" v="STANDBY" />
            <Row k="SECURITY LAYER" v="ACTIVE" live />
            <Row k="VOICE INPUT" v="SEALED" />
            <Row k="NETWORK LINK" v={online ? 'STABLE' : 'LOST'} />
            <Row k="UPTIME" v={stats ? duration(stats.uptime) : '—'} />
          </div>
        </div>
      </Panel>

      <Panel title="SECURITY ANALYSIS" className="sa-threat" delay={200}>
        <div className="cc-split">
          <FlatMap color={colour} className="cc-threat-map" pings={failures ? 9 : 4} />
          <div className="cc-rows">
            <Row k="THREAT LEVEL" v={<span className={threat === 'LOW' ? '' : 'cc-warn'}>{threat}</span>} live={threat === 'LOW'} />
            <Row k="FAILED ATTEMPTS" v={failures} />
            <Row k="ATTEMPTS LEFT" v={status ? status.attemptsLeft : '—'} />
            <Row k="LOCKOUT" v={waiting ? `${Math.ceil((status?.waitMs ?? 0) / 1000)} s` : 'NONE'} />
            <Row k="SYSTEM INTEGRITY" v={<Num value={100} suffix="%" />} live />
          </div>
        </div>
      </Panel>

      <Panel title="ACCESS LOG" className="sa-log" delay={300}>
        <div className="sa-log-list">
          {log.map(([at, what, ok], i) => (
            <div key={`${at}-${i}`} className="sa-log-row">
              <span className="cc-v">{at}</span>
              <span className="cc-k">{what}</span>
              <span className={ok ? 'cc-live' : 'sa-bad'}>{ok ? 'SUCCESS' : 'FAILED'}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="DATA STREAMS" className="sa-streams" delay={400}>
        <div className="cc-stream-list sa-stream-list">
          {streams.map(([name, value], i) => (
            <div key={name} className="cc-stream sa-stream">
              <span className="cc-stream-dot" />
              <span className="cc-k">{name}</span>
              <span className="cc-stream-state">
                <Num value={values[i] ?? null} suffix="%" />
              </span>
              <Sparkline color={colour} value={value} seed={i * 1.7} className="cc-stream-line" fill={false} />
            </div>
          ))}
        </div>
      </Panel>
    </aside>
  )
}

/* ---------------------------------------------------------------- right */

const MODULES = ['PASSCODE LOCK', 'CONFIRMATION GATE', 'ORIGIN GUARD', 'KEY VAULT', 'SECRET REDACTION', 'GUESS LIMITER']

function RightSide({ colour, status, busy }: { colour: string; status: LockStatus | null; busy: boolean }) {
  const { stats, latency, online } = useBridgeStats()
  const gpu = stats?.gpu
  const w = stats?.weather
  return (
    <aside className="cc-col cc-right">
      <Panel title="AUTHENTICATION STATUS" className="sa-auth" delay={150}>
        <div className="cc-split">
          <Fingerprint scanning={busy} />
          <div className="cc-rows">
            <Row k="STATE" v={busy ? 'VERIFYING' : 'AWAITING CODE'} live />
            <Row k="PASSCODE" v={status?.mode === 'unset' ? 'NOT SET' : 'REQUIRED'} />
            <Row k="BIOMETRIC" v="NOT USED" />
            <Row k="STORED AS" v="SCRYPT HASH" />
            <Row k="SECURITY LEVEL" v="HIGH" live />
          </div>
        </div>
      </Panel>

      <Panel title="SYSTEM DIAGNOSTICS" className="sa-diag" delay={250}>
        <div className="cc-gauges">
          <Gauge value={stats?.cpu ?? null} label="CPU" color={colour} />
          <Gauge value={gpu?.util ?? null} label="GPU" color={colour} />
          <Gauge value={stats?.ram ?? null} label="RAM" color={colour} />
          <Gauge value={stats?.disk ?? null} label="STORAGE" color={colour} />
        </div>
      </Panel>

      <Panel title="NETWORK STATUS" className="sa-net" delay={350}>
        <div className="cc-split">
          <Globe color={colour} className="cc-world-globe" density={3.2} satellites={3} speed={14} />
          <div className="cc-rows">
            <Row k="BRIDGE" v={online ? 'ONLINE' : 'DOWN'} live={online} />
            <Row k="CONNECTION" v="LOCAL ONLY" />
            <Row k="LATENCY" v={<Num value={latency} suffix=" ms" />} />
            <Row k="ORIGIN CHECK" v="ON" />
            <Row k="LOCATION" v={w?.place ?? '—'} />
          </div>
        </div>
      </Panel>

      <Panel title="SECURITY MODULES" className="sa-modules" delay={450}>
        <div className="sa-module-grid">
          <Bars color={colour} className="sa-module-bars" count={10} />
          <div className="sa-module-list">
            {MODULES.map((m, i) => (
              <div key={m} className="sa-module" style={{ ['--i' as string]: String(i) }}>
                <span className="cc-k">{m}</span>
                <span className="sa-module-bar">
                  <span />
                </span>
                <span className="cc-live">ACTIVE</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </aside>
  )
}

/* --------------------------------------------------------------- centre */

export function SecureAccess({ colour }: { colour: string }) {
  const [status, setStatus] = useState<LockStatus | null>(null)
  const [stage, setStage] = useState<Stage>('connecting')
  const [digits, setDigits] = useState('')
  const [first, setFirst] = useState('')
  const [note, setNote] = useState<Note | null>(null)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)
  const [open, setOpen] = useState(false)
  const [until, setUntil] = useState(0)
  const phase = useStore((s) => s.phase)
  useTick(until > Date.now() ? 250 : 5000)

  const waitMs = Math.max(0, until - Date.now())
  const blocked = stage === 'connecting' || busy || open || waitMs > 0

  const learn = useCallback((s: LockStatus) => {
    setStatus(s)
    setUntil(s.waitMs > 0 ? Date.now() + s.waitMs : 0)
  }, [])

  const letIn = useCallback(() => {
    setOpen(true)
    setNote({ text: 'ACCESS GRANTED', tone: 'good' })
    window.setTimeout(granted, 900)
  }, [])

  // Ask the bridge what it wants: a new code, the code, or nothing at all.
  useEffect(() => {
    let alive = true
    let timer = 0
    const ask = async () => {
      try {
        const s = await lockStatus()
        if (!alive) return
        learn(s)
        if (s.mode === 'off') {
          const r = await passcode('unlock')
          if (r.ok) return granted()
        }
        setStage(s.mode === 'unset' ? 'create' : 'enter')
        if (s.mode === 'unset') setNote({ text: 'FIRST START — CHOOSE YOUR PASSCODE', tone: 'info' })
      } catch {
        if (!alive) return
        setNote({ text: 'WAITING FOR THE BRIDGE…', tone: 'info' })
        timer = window.setTimeout(() => void ask(), 1500)
      }
    }
    void ask()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [learn, letIn])

  const deny = (text: string) => {
    setShake((n) => n + 1)
    setNote({ text, tone: 'bad' })
    setDigits('')
  }

  const submit = async (code: string) => {
    if (stage === 'create') {
      setFirst(code)
      setDigits('')
      setStage('confirm')
      setNote({ text: 'ENTER THE SAME CODE AGAIN', tone: 'info' })
      return
    }
    if (stage === 'confirm' && code !== first) {
      setFirst('')
      setStage('create')
      return deny('THE CODES DID NOT MATCH — START AGAIN')
    }
    setBusy(true)
    try {
      const reply = await passcode(stage === 'confirm' ? 'create' : 'unlock', { code })
      learn(reply)
      if (reply.ok) return letIn()
      const left = reply.waitMs > 0 ? '' : reply.attemptsLeft > 0 ? ` · ${reply.attemptsLeft} LEFT` : ''
      deny(`${(reply.error ?? 'ACCESS DENIED').replace(/\.$/, '').toUpperCase()}${left}`)
    } catch {
      deny('THE BRIDGE DID NOT ANSWER — TRY AGAIN')
    } finally {
      setBusy(false)
    }
  }

  // The sixth digit is the ENTER key. A beat first, so the last box fills visibly.
  const submitRef = useRef(submit)
  submitRef.current = submit
  useEffect(() => {
    if (digits.length !== LENGTH) return
    const t = window.setTimeout(() => void submitRef.current(digits), 180)
    return () => window.clearTimeout(t)
  }, [digits])

  const press = useCallback(
    (d: string) => {
      if (blocked) return
      setDigits((s) => (s.length < LENGTH ? s + d : s))
      setNote((n) => (n?.tone === 'bad' ? null : n))
    },
    [blocked],
  )
  const erase = useCallback(() => {
    if (!blocked) setDigits((s) => s.slice(0, -1))
  }, [blocked])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        press(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        erase()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press, erase])

  const message =
    waitMs > 0
      ? { text: `LOCKED OUT · TRY AGAIN IN ${Math.ceil(waitMs / 1000)} S`, tone: 'bad' as const }
      : note

  return (
    <>
      <LeftSide colour={colour} status={status} />

      <main className="cc-center sa-center">
        <div className="cc-center-top">
          <div className="cc-init">
            <span>SECURITY PROTOCOL</span>
            <span className="cc-progress cc-progress-run">
              <span />
            </span>
          </div>
          <div className="cc-nominal">
            <span className={open ? '' : 'cc-warn'}>{open ? 'ACCESS GRANTED' : 'AUTHENTICATION REQUIRED'}</span>
            <span className="cc-progress">
              <span style={{ width: open ? '100%' : `${(digits.length / LENGTH) * 100}%` }} />
            </span>
          </div>
        </div>

        <section
          className={`sa-card ${open ? 'open' : ''} ${message?.tone === 'bad' ? 'bad' : ''} ${phase === 'offline' ? 'dark' : ''}`}
          aria-label="Secure access"
        >
          <i className="cc-c cc-c-tl" />
          <i className="cc-c cc-c-tr" />
          <i className="cc-c cc-c-bl" />
          <i className="cc-c cc-c-br" />
          <LockIcon />
          <h1 className="sa-title">SECURE ACCESS</h1>
          <div className="sa-prompt">{PROMPT[stage]}</div>

          <div
            key={shake}
            className={`sa-boxes ${shake ? 'shake' : ''}`}
            onClick={erase}
            title="Tap to take back the last digit"
            role="status"
            aria-label={`${digits.length} of ${LENGTH} digits entered`}
          >
            {Array.from({ length: LENGTH }, (_, i) => (
              <span key={i} className={`sa-box ${i < digits.length ? 'full' : ''} ${i === digits.length && !blocked ? 'next' : ''}`}>
                <b />
              </span>
            ))}
          </div>

          <div className={`sa-note ${message?.tone ?? ''}`}>{message?.text ?? 'TYPE OR TAP · BACKSPACE TO CORRECT'}</div>

          <div className="sa-pad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => (
              <button key={d} className={`sa-key ${d === '0' ? 'zero' : ''}`} disabled={blocked} onClick={() => press(d)}>
                {d}
              </button>
            ))}
          </div>

          <div className="sa-foot">
            <ShieldIcon />
            <div>
              <div className="sa-foot-a">HASHED PASSCODE · CHECKED ON THIS PC</div>
              <div className="sa-foot-b">AUTHORIZED ACCESS ONLY</div>
            </div>
          </div>
        </section>
      </main>

      <RightSide colour={colour} status={status} busy={busy} />
    </>
  )
}
