import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'

/**
 * JARVIS asking permission.
 *
 * Shown whenever the bridge wants to do something that changes the world — a
 * click or keystroke on a web page, a file to the recycle bin. It stays up
 * until the user answers by voice ("yes" / "no"), by key (Y / N) or by
 * clicking, or until the bridge stops waiting, which counts as no.
 *
 * Tinted red on purpose: it is the one element of the interface that needs a
 * decision, and it must not read as another status readout.
 */
export function Confirm() {
  const confirm = useStore((s) => s.confirm)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!confirm) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [confirm])

  const left = confirm ? Math.max(0, Math.ceil((confirm.expires - now) / 1000)) : 0

  return (
    <AnimatePresence>
      {confirm && (
        <motion.div
          key={confirm.id}
          className="confirm"
          role="alertdialog"
          aria-label="JARVIS needs your confirmation"
          initial={{ opacity: 0, x: '-50%', y: 10, filter: 'blur(6px)' }}
          animate={{ opacity: 1, x: '-50%', y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, x: '-50%', y: 10, filter: 'blur(6px)' }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        >
          <div className="confirm-kicker">
            <span className="confirm-dot" />
            confirmation required · {left}s
          </div>
          <div className="confirm-action">{confirm.action}</div>
          {confirm.detail && <div className="confirm-detail">{confirm.detail}</div>}
          <div className="confirm-buttons">
            <button className="confirm-yes" onClick={() => confirm.answer(true)}>
              Confirm <kbd>Y</kbd>
            </button>
            <button className="confirm-no" onClick={() => confirm.answer(false)}>
              Deny <kbd>N</kbd>
            </button>
          </div>
          <div className="confirm-hint">or say “yes” or “no”</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
