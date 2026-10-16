import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { BRIDGE_HTTP_URL } from '../../config'
import { useStore, type Phase } from '../../store'

/* ------------------------------------------------------------------ stats */

export type Stats = {
  cpu: number
  cores: number
  ram: number
  ramTotalGb: number
  disk: number | null
  gpu: { name: string; util: number | null; temp: number | null; power: number | null; fan: number | null; memory: number | null } | null
  uptime: number
  bridgeUptime: number
  weather: { place: string; lat: number; lon: number; temp: number; humidity: number; wind: number; sky: string } | null
}

type StatsState = { stats: Stats | null; online: boolean; latency: number | null; cpuHistory: number[] }

const useStats = create<StatsState>(() => ({ stats: null, online: false, latency: null, cpuHistory: [] }))

let polling = 0
async function poll() {
  const t0 = performance.now()
  try {
    const res = await fetch(`${BRIDGE_HTTP_URL}/stats`, { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    if (!res.ok) throw new Error(String(res.status))
    const stats = (await res.json()) as Stats
    useStats.setState((s) => ({
      stats,
      online: true,
      latency: Math.round(performance.now() - t0),
      cpuHistory: [...s.cpuHistory.slice(-59), stats.cpu],
    }))
  } catch {
    useStats.setState({ online: false, latency: null })
  }
}

/** Live readings from the bridge, polled every two seconds while anything shows them. */
export function useBridgeStats(): StatsState {
  useEffect(() => {
    if (polling++ === 0) void poll()
    const timer = window.setInterval(() => void poll(), 2000)
    return () => {
      polling--
      window.clearInterval(timer)
    }
  }, [])
  return useStats()
}

/** The latest readings without subscribing, for canvases that read every frame. */
export const statsNow = () => useStats.getState()

/* --------------------------------------------------------------- activity */

export type Activity = { id: number; at: Date; text: string }

type ActivityState = {
  items: Activity[]
  turns: number
  tools: number
  words: number
  /** Runs per tool, by readable name. */
  toolCounts: Record<string, number>
  startedAt: number
}

export const useActivity = create<ActivityState>(() => ({
  items: [],
  turns: 0,
  tools: 0,
  words: 0,
  toolCounts: {},
  startedAt: Date.now(),
}))

let nextId = 1
function log(text: string) {
  useActivity.setState((s) => ({ items: [{ id: nextId++, at: new Date(), text }, ...s.items].slice(0, 60) }))
}

/** `jarvis_pc · mouse` → `mouse`, the name people read. */
export const toolName = (raw: string) => raw.replace(/^jarvis_\w+ · /, '').replace(/[_-]/g, ' ')

export const PHASE_LABEL: Record<Phase, string> = {
  offline: 'OFFLINE',
  boot: 'INITIALIZING',
  dormant: 'STANDING BY',
  waking: 'ONLINE',
  listening: 'LISTENING',
  thinking: 'THINKING',
  tooling: 'ACCESSING SYSTEMS',
  speaking: 'RESPONDING',
}

const short = (s: string, n = 64) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/**
 * What JARVIS has actually been doing, recorded from the store as it happens:
 * questions, tools, answers, confirmations, errors. Mounted once.
 */
export function useActivityRecorder() {
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.phase !== prev.phase) {
          if (prev.phase === 'boot' && s.phase === 'dormant') log('All systems online — standing by')
          if (prev.phase === 'speaking' && s.phase !== 'speaking') {
            const last = [...s.turns].reverse().find((t) => t.role === 'jarvis')
            if (last?.text) {
              log(`Answered: ${short(last.text)}`)
              useActivity.setState((a) => ({ words: a.words + last.text.split(/\s+/).filter(Boolean).length }))
            }
          }
        }
        if (s.turns.length && s.turns !== prev.turns) {
          const last = s.turns[s.turns.length - 1]
          const before = prev.turns[prev.turns.length - 1]
          if (last.role === 'user' && last.id !== before?.id) {
            log(`You: ${short(last.text)}`)
            useActivity.setState((a) => ({ turns: a.turns + 1 }))
          }
        }
        if (s.activeTool && s.activeTool !== prev.activeTool) {
          const name = toolName(s.activeTool)
          log(`Running ${name}`)
          useActivity.setState((a) => ({
            tools: a.tools + 1,
            toolCounts: { ...a.toolCounts, [name]: (a.toolCounts[name] ?? 0) + 1 },
          }))
        }
        if (s.confirm && s.confirm !== prev.confirm) log(`Asked you to confirm: ${short(s.confirm.action)}`)
        if (s.error && s.error !== prev.error) log(`Alert: ${short(s.error)}`)
        if (s.blades.length > prev.blades.length) log(`Opened ${s.blades[s.blades.length - 1].title.toLowerCase()}`)
      }),
    [],
  )
}

/* ------------------------------------------------------------------ time */

/** Re-render every `ms`, for clocks and anything that drifts on its own. */
export function useTick(ms: number): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setN((x) => x + 1), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return n
}

export const hhmm = (d: Date) => d.toTimeString().slice(0, 5)

export function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(seconds % 60).padStart(2, '0')}s`
}
