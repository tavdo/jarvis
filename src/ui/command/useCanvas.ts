import { useEffect, useRef } from 'react'

export type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void

/**
 * A canvas that redraws itself on a frame budget.
 *
 * Every instrument on the command centre is one of these, and there are a
 * dozen of them on screen beside a WebGL reactor — so each one is capped at
 * `fps`, sized to its box at device resolution, and stops entirely while the
 * page is hidden. The draw function is read through a ref, so it can close
 * over fresh props without restarting the loop.
 */
export function useCanvas(draw: Draw, fps = 30) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    let w = 0
    let h = 0
    const fit = () => {
      const r = el.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = r.width
      h = r.height
      el.width = Math.max(1, Math.round(w * dpr))
      el.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)

    let raf = 0
    let last = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (now - last < 1000 / fps) return
      last = now
      if (!w || !h) return
      ctx.clearRect(0, 0, w, h)
      drawRef.current(ctx, w, h, now / 1000)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [fps])

  return canvas
}

/** The current accent colour as rgba(), for canvas strokes. */
export function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(70, 255, 140, ${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
