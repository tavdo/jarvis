import { useEffect, useRef, useState, type ReactNode } from 'react'

/** The bracketed, scanned card every panel of the deck sits in. */
export function Panel({
  title,
  children,
  className = '',
  delay = 0,
  tag,
}: {
  title: string
  children: ReactNode
  className?: string
  delay?: number
  tag?: ReactNode
}) {
  return (
    <section className={`cc-panel ${className}`} style={{ ['--d' as string]: `${delay}ms` }}>
      <i className="cc-c cc-c-tl" />
      <i className="cc-c cc-c-tr" />
      <i className="cc-c cc-c-bl" />
      <i className="cc-c cc-c-br" />
      <header className="cc-panel-head">
        <span className="cc-panel-title">{title}</span>
        <span className="cc-panel-tag">{tag ?? <><b /><b /></>}</span>
      </header>
      <div className="cc-panel-body">{children}</div>
      <span className="cc-sweep" />
    </section>
  )
}

export function Row({ k, v, live }: { k: string; v: ReactNode; live?: boolean }) {
  return (
    <div className="cc-row">
      <span className="cc-k">{k}</span>
      <span className={`cc-v ${live ? 'cc-live' : ''}`}>{v}</span>
    </div>
  )
}

/** A number that eases toward its target instead of jumping. */
export function Num({ value, digits = 0, suffix = '' }: { value: number | null | undefined; digits?: number; suffix?: string }) {
  const [shown, setShown] = useState(value ?? 0)
  const target = useRef(value ?? 0)
  target.current = value ?? 0
  useEffect(() => {
    let raf = 0
    const step = () => {
      setShown((s) => {
        const d = target.current - s
        return Math.abs(d) < 0.05 ? target.current : s + d * 0.15
      })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])
  if (value === null || value === undefined) return <>—</>
  return (
    <>
      {shown.toFixed(digits)}
      {suffix}
    </>
  )
}
