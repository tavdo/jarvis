import { useMemo, useRef } from 'react'
import { useStore } from '../../store'
import { landPoints } from './land'
import { rgba, useCanvas } from './useCanvas'

const RAD = Math.PI / 180

/* ------------------------------------------------------------------ globe */

/**
 * A dotted holographic Earth, turning. Land is dots, the sea is a faint grid,
 * and a few satellites trace their orbits. `pulse` (0..1) brightens it with
 * JARVIS's voice.
 */
export function Globe({
  color,
  speed = 8,
  tilt = 18,
  density = 2.6,
  satellites = 3,
  pulse,
  className,
}: {
  color: string
  speed?: number
  tilt?: number
  density?: number
  satellites?: number
  pulse?: () => number
  className?: string
}) {
  const land = useMemo(() => landPoints(density), [density])
  const sats = useMemo(
    () =>
      Array.from({ length: satellites }, (_, i) => ({
        incl: 25 + i * 37,
        node: i * 71,
        speed: 0.35 + i * 0.18,
        r: 1.18 + i * 0.07,
      })),
    [satellites],
  )

  const ref = useCanvas((ctx, w, h, t) => {
    const R = Math.min(w, h) * 0.42
    const cx = w / 2
    const cy = h / 2
    const spin = t * speed * RAD
    const ct = Math.cos(tilt * RAD)
    const st = Math.sin(tilt * RAD)
    const glow = 0.55 + (pulse?.() ?? 0) * 0.45

    const project = (lat: number, lon: number, r = 1) => {
      const la = lat * RAD
      const lo = lon * RAD + spin
      const x = Math.cos(la) * Math.sin(lo)
      const y0 = Math.sin(la)
      const z0 = Math.cos(la) * Math.cos(lo)
      const y = y0 * ct - z0 * st
      const z = y0 * st + z0 * ct
      return [cx + x * R * r, cy - y * R * r, z] as const
    }

    // Atmosphere.
    const halo = ctx.createRadialGradient(cx, cy, R * 0.75, cx, cy, R * 1.35)
    halo.addColorStop(0, rgba(color, 0.0))
    halo.addColorStop(0.35, rgba(color, 0.16 * glow))
    halo.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, w, h)

    const body = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R)
    body.addColorStop(0, rgba(color, 0.14))
    body.addColorStop(1, rgba(color, 0.03))
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.fill()

    // Graticule.
    ctx.lineWidth = 0.6
    ctx.strokeStyle = rgba(color, 0.18)
    for (let lon = -180; lon < 180; lon += 30) {
      ctx.beginPath()
      let pen = false
      for (let lat = -90; lat <= 90; lat += 6) {
        const [x, y, z] = project(lat, lon)
        if (z < 0) {
          pen = false
          continue
        }
        if (pen) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
        pen = true
      }
      ctx.stroke()
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath()
      let pen = false
      for (let lon = -180; lon <= 180; lon += 6) {
        const [x, y, z] = project(lat, lon)
        if (z < 0) {
          pen = false
          continue
        }
        if (pen) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
        pen = true
      }
      ctx.stroke()
    }

    // Land.
    const dot = Math.max(1, R / 90)
    for (const [lat, lon] of land) {
      const [x, y, z] = project(lat, lon)
      if (z < 0.02) continue
      ctx.fillStyle = rgba(color, (0.25 + z * 0.75) * glow)
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot)
    }

    // Rim.
    ctx.lineWidth = 1.4
    ctx.strokeStyle = rgba(color, 0.55 * glow)
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.stroke()

    // Satellites and their orbits.
    for (const s of sats) {
      const orbit = (a: number) => {
        const x = Math.cos(a)
        const y = Math.sin(a) * Math.sin(s.incl * RAD)
        const z = Math.sin(a) * Math.cos(s.incl * RAD)
        const n = s.node * RAD
        const xr = x * Math.cos(n) - z * Math.sin(n)
        const zr = x * Math.sin(n) + z * Math.cos(n)
        return [cx + xr * R * s.r, cy - y * R * s.r * 0.9, zr] as const
      }
      ctx.beginPath()
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.08) {
        const [x, y] = orbit(a)
        if (a === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = rgba(color, 0.14)
      ctx.lineWidth = 0.7
      ctx.stroke()
      const [x, y, z] = orbit(t * s.speed)
      if (z < 0 && Math.hypot(x - cx, y - cy) < R) continue
      ctx.fillStyle = rgba(color, 0.95)
      ctx.shadowColor = rgba(color, 1)
      ctx.shadowBlur = 8
      ctx.beginPath()
      ctx.arc(x, y, 2.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
    }
  }, 30)

  return <canvas ref={ref} className={`cc-canvas ${className ?? ''}`} />
}

/* --------------------------------------------------------------- flat map */

/** The world laid flat, with signals blooming where things are happening. */
export function FlatMap({ color, pings = 7, className }: { color: string; pings?: number; className?: string }) {
  const land = useMemo(() => landPoints(3.2), [])
  const spots = useMemo(() => {
    const out: { lat: number; lon: number; offset: number }[] = []
    for (let i = 0; out.length < pings && i < 400; i++) {
      const [lat, lon] = land[(i * 7919) % land.length]
      if (lat > -55 && lat < 70) out.push({ lat, lon, offset: (i * 0.37) % 1 })
    }
    return out
  }, [land, pings])

  const ref = useCanvas((ctx, w, h, t) => {
    const px = (lon: number) => ((lon + 180) / 360) * w
    const py = (lat: number) => ((90 - lat) / 180) * h * 1.12 - h * 0.06
    const dot = Math.max(1, w / 260)
    ctx.fillStyle = rgba(color, 0.42)
    for (const [lat, lon] of land) {
      if (lat < -60) continue
      ctx.fillRect(px(lon), py(lat), dot, dot)
    }
    // A scan line sweeping west to east.
    const sx = ((t * 0.12) % 1) * w
    const grad = ctx.createLinearGradient(sx - 40, 0, sx, 0)
    grad.addColorStop(0, rgba(color, 0))
    grad.addColorStop(1, rgba(color, 0.22))
    ctx.fillStyle = grad
    ctx.fillRect(sx - 40, 0, 40, h)
    for (const s of spots) {
      const x = px(s.lon)
      const y = py(s.lat)
      const k = (t * 0.45 + s.offset) % 1
      ctx.strokeStyle = rgba(color, 1 - k)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(x, y, 2 + k * 12, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = rgba('#ffd34d', 0.9)
      ctx.beginPath()
      ctx.arc(x, y, 1.8, 0, Math.PI * 2)
      ctx.fill()
    }
  }, 24)
  return <canvas ref={ref} className={`cc-canvas ${className ?? ''}`} />
}

/* -------------------------------------------------------------- sparkline */

/**
 * A scrolling trace. `value` is read every frame (0..1); when it is omitted the
 * trace is its own seeded signal, so idle streams still flow.
 */
export function Sparkline({
  color,
  value,
  seed = 1,
  fill = true,
  className,
}: {
  color: string
  value?: () => number
  seed?: number
  fill?: boolean
  className?: string
}) {
  const history = useRef<number[]>([])
  const ref = useCanvas((ctx, w, h, t) => {
    const n = Math.max(24, Math.floor(w / 3))
    const v = value
      ? value()
      : 0.5 + Math.sin(t * 1.3 + seed) * 0.22 + Math.sin(t * 3.7 + seed * 2.1) * 0.12 + (Math.random() - 0.5) * 0.12
    const hist = history.current
    hist.push(Math.max(0, Math.min(1, v)))
    while (hist.length > n) hist.shift()
    const step = w / (n - 1)
    const off = n - hist.length
    ctx.beginPath()
    hist.forEach((p, i) => {
      const x = (i + off) * step
      const y = h - 2 - p * (h - 4)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = rgba(color, 0.95)
    ctx.lineWidth = 1.2
    ctx.shadowColor = rgba(color, 0.9)
    ctx.shadowBlur = 4
    ctx.stroke()
    ctx.shadowBlur = 0
    if (fill && hist.length > 1) {
      ctx.lineTo(w, h)
      ctx.lineTo(off * step, h)
      ctx.closePath()
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, rgba(color, 0.28))
      g.addColorStop(1, rgba(color, 0))
      ctx.fillStyle = g
      ctx.fill()
    }
  }, 20)
  return <canvas ref={ref} className={`cc-canvas ${className ?? ''}`} />
}

/* ------------------------------------------------------------- waveform */

/**
 * JARVIS's ears and voice: mirrored bars from the live level, scrolling left.
 * Idle, it breathes, so the monitor never looks dead.
 */
export function Waveform({
  color,
  bars = 64,
  className,
  center = true,
}: {
  color: string
  bars?: number
  className?: string
  center?: boolean
}) {
  const history = useRef<number[]>([])
  const ref = useCanvas((ctx, w, h, t) => {
    const level = useStore.getState().level
    const idle = 0.05 + Math.abs(Math.sin(t * 2.1)) * 0.04
    const hist = history.current
    hist.push(Math.max(idle, Math.min(1, level * (0.75 + Math.random() * 0.5))))
    while (hist.length > bars) hist.shift()
    const bw = w / bars
    hist.forEach((v, i) => {
      const x = (i + (bars - hist.length)) * bw
      const bh = Math.max(1.5, v * h * 0.92)
      const fade = 0.25 + (i / hist.length) * 0.75
      ctx.fillStyle = rgba(color, fade)
      if (center) ctx.fillRect(x + bw * 0.2, (h - bh) / 2, bw * 0.6, bh)
      else ctx.fillRect(x + bw * 0.2, h - bh, bw * 0.6, bh)
    })
  }, 30)
  return <canvas ref={ref} className={`cc-canvas ${className ?? ''}`} />
}

/* --------------------------------------------------------------- terrain */

/** A wireframe landscape rolling toward the viewer — the "live sensors" view. */
export function Terrain({ color, className }: { color: string; className?: string }) {
  const ref = useCanvas((ctx, w, h, t) => {
    const rows = 22
    const cols = 34
    const height = (x: number, z: number) => {
      const peak = Math.exp(-((x - 0.45) ** 2) * 18 - ((z - 0.55) ** 2) * 10) * 1.1
      return (
        peak +
        Math.sin(x * 9 + t * 0.3) * 0.08 +
        Math.sin(z * 7 - t * 0.6 + x * 3) * 0.1 +
        Math.sin((x + z) * 15 + t) * 0.03
      )
    }
    // A camera 1.2 units above the ground looking at the horizon; z runs from
    // the viewer (0) to the far edge (1).
    const project = (x: number, z: number, y: number) => {
      const depth = 1 + z * 3
      const sx = w / 2 + ((x - 0.5) * 3 * w * 0.5) / depth
      const sy = h * 0.18 + ((1.2 - y * 0.9) * h * 0.62) / depth
      return [sx, sy] as const
    }
    const scroll = (t * 0.04) % (1 / rows)
    ctx.lineWidth = 0.8
    for (let r = rows; r >= 0; r--) {
      const z = r / rows - scroll
      if (z < 0) continue
      ctx.beginPath()
      for (let c = 0; c <= cols; c++) {
        const x = c / cols
        const [sx, sy] = project(x, z, height(x, z + t * 0.04))
        if (c === 0) ctx.moveTo(sx, sy)
        else ctx.lineTo(sx, sy)
      }
      ctx.strokeStyle = rgba(color, 0.15 + (1 - z) * 0.6)
      ctx.stroke()
    }
    for (let c = 0; c <= cols; c += 2) {
      const x = c / cols
      ctx.beginPath()
      for (let r = 0; r <= rows; r++) {
        const z = r / rows - scroll
        if (z < 0) continue
        const [sx, sy] = project(x, z, height(x, z + t * 0.04))
        if (r === 0) ctx.moveTo(sx, sy)
        else ctx.lineTo(sx, sy)
      }
      ctx.strokeStyle = rgba(color, 0.18)
      ctx.stroke()
    }
  }, 24)
  return <canvas ref={ref} className={`cc-canvas ${className ?? ''}`} />
}

/* ------------------------------------------------------------------ bars */

/** A holographic skyline of bars, rising and settling in waves. */
export function Bars({ color, count = 14, className }: { color: string; count?: number; className?: string }) {
  const ref = useCanvas((ctx, w, h, t) => {
    const gap = w / count
    // A floor grid in perspective.
    ctx.strokeStyle = rgba(color, 0.12)
    ctx.lineWidth = 0.6
    for (let i = 0; i <= 6; i++) {
      const y = h - (i * h * 0.12) / 6
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
    for (let i = 0; i < count; i++) {
      const v = 0.25 + 0.55 * Math.abs(Math.sin(t * 0.6 + i * 0.7)) + 0.2 * Math.abs(Math.sin(t * 1.7 + i * 1.9))
      const bh = v * h * 0.82
      const x = i * gap + gap * 0.18
      const bw = gap * 0.64
      const g = ctx.createLinearGradient(0, h - bh, 0, h)
      g.addColorStop(0, rgba(color, 0.9))
      g.addColorStop(1, rgba(color, 0.12))
      ctx.fillStyle = g
      ctx.fillRect(x, h - bh, bw, bh)
      // Side face, for depth.
      ctx.fillStyle = rgba(color, 0.25)
      ctx.beginPath()
      ctx.moveTo(x + bw, h - bh)
      ctx.lineTo(x + bw + bw * 0.35, h - bh - bw * 0.25)
      ctx.lineTo(x + bw + bw * 0.35, h - bw * 0.25)
      ctx.lineTo(x + bw, h)
      ctx.fill()
      ctx.fillStyle = rgba(color, 1)
      ctx.fillRect(x, h - bh, bw, 1.5)
    }
  }, 24)
  return <canvas ref={ref} className={`cc-canvas ${className ?? ''}`} />
}

/* --------------------------------------------------------------- polyorb */

/** A slowly turning wireframe solid — the geodesic ornaments of the analytics deck. */
export function PolyOrb({ color, kind = 'ico', className }: { color: string; kind?: 'ico' | 'ring'; className?: string }) {
  const verts = useMemo(() => {
    if (kind === 'ring') {
      const v: [number, number, number][] = []
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2
        v.push([Math.cos(a), Math.sin(a), 0], [Math.cos(a) * 0.55, Math.sin(a) * 0.55, Math.sin(a * 3) * 0.3])
      }
      return v
    }
    const p = (1 + Math.sqrt(5)) / 2
    return (
      [
        [-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0],
        [0, -1, p], [0, 1, p], [0, -1, -p], [0, 1, -p],
        [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1],
      ] as [number, number, number][]
    ).map(([x, y, z]) => {
      const l = Math.hypot(x, y, z)
      return [x / l, y / l, z / l] as [number, number, number]
    })
  }, [kind])

  const ref = useCanvas((ctx, w, h, t) => {
    const R = Math.min(w, h) * 0.38
    const cx = w / 2
    const cy = h / 2
    const a = t * 0.5
    const b = t * 0.31
    const pts = verts.map(([x, y, z]) => {
      const x1 = x * Math.cos(a) - z * Math.sin(a)
      const z1 = x * Math.sin(a) + z * Math.cos(a)
      const y1 = y * Math.cos(b) - z1 * Math.sin(b)
      const z2 = y * Math.sin(b) + z1 * Math.cos(b)
      return [cx + x1 * R, cy + y1 * R, z2] as const
    })
    ctx.lineWidth = 0.8
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(verts[i][0] - verts[j][0], verts[i][1] - verts[j][1], verts[i][2] - verts[j][2])
        if (d > (kind === 'ring' ? 0.75 : 1.15)) continue
        const depth = (pts[i][2] + pts[j][2]) / 2
        ctx.strokeStyle = rgba(color, 0.25 + (depth + 1) * 0.3)
        ctx.beginPath()
        ctx.moveTo(pts[i][0], pts[i][1])
        ctx.lineTo(pts[j][0], pts[j][1])
        ctx.stroke()
      }
    }
    for (const [x, y, z] of pts) {
      ctx.fillStyle = rgba(color, 0.5 + (z + 1) * 0.25)
      ctx.beginPath()
      ctx.arc(x, y, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.strokeStyle = rgba(color, 0.35)
    ctx.beginPath()
    ctx.arc(cx, cy, R * 1.25, t % (Math.PI * 2), (t % (Math.PI * 2)) + Math.PI * 1.4)
    ctx.stroke()
  }, 24)
  return <canvas ref={ref} className={`cc-canvas ${className ?? ''}`} />
}

/* --------------------------------------------------------------- gauge */

/** A ring gauge: the arc eases to `value` (0..100) and a tick ring turns around it. */
export function Gauge({ value, label, color }: { value: number | null; label: string; color: string }) {
  const r = 40
  const c = 2 * Math.PI * r
  const v = value ?? 0
  return (
    <div className="cc-gauge">
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} className="cc-gauge-track" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className="cc-gauge-arc"
          style={{ stroke: color, strokeDasharray: `${(c * v) / 100} ${c}` }}
        />
        <circle cx="50" cy="50" r="47" className="cc-gauge-ticks" style={{ stroke: color }} />
      </svg>
      <div className="cc-gauge-value">
        {value === null ? '—' : Math.round(v)}
        {value !== null && <small>%</small>}
      </div>
      <div className="cc-gauge-label">{label}</div>
    </div>
  )
}
