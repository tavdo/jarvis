import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'
import { reportIntroDone } from '../lib/intro'
import { usePrefs } from '../lib/prefs'
import intro from '../assets/jarvis-intro-v2-green.mp4'

/**
 * The start-up sequence: the intro film, full screen, with its own soundtrack.
 * Its length is the boot's length (see lib/intro.ts); clicking it skips the rest.
 * Switched off in Settings, the boot hands over straight away.
 */
export function Boot() {
  const phase = useStore((s) => s.phase)
  const enabled = usePrefs((p) => p.intro)
  const video = useRef<HTMLVideoElement>(null)
  const playing = phase === 'boot' && enabled

  // The interface behind an opaque full-screen film still renders every frame,
  // and that alone was enough to starve the video into stalling for seconds at
  // a time. Hidden until the boot ends, so the fade-out reveals it.
  useEffect(() => {
    document.body.classList.toggle('intro-playing', playing)
  }, [playing])

  useEffect(() => {
    if (phase === 'boot' && !enabled) reportIntroDone()
  }, [phase, enabled])

  useEffect(() => {
    const v = video.current
    if (!playing || !v) return
    let reported = false
    const finish = () => {
      if (reported) return
      reported = true
      reportIntroDone()
    }
    v.currentTime = 0
    v.muted = false
    // With sound needs a user gesture; the power-on click is one, and the
    // desktop app runs with autoplay allowed. A browser that still refuses
    // gets the picture without the sound rather than no intro at all.
    v.play().catch(() => {
      v.muted = true
      v.play().catch(finish)
    })
    v.addEventListener('ended', finish)
    v.addEventListener('error', finish)
    v.addEventListener('click', finish)
    return () => {
      v.removeEventListener('ended', finish)
      v.removeEventListener('error', finish)
      v.removeEventListener('click', finish)
      v.pause()
    }
  }, [playing])

  return (
    <AnimatePresence>
      {playing && (
        <motion.div
          key="boot"
          className="boot"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, filter: 'blur(10px)' }}
          transition={{ duration: 0.8 }}
        >
          <video
            ref={video}
            className="boot-video"
            src={intro}
            preload="auto"
            playsInline
            title="Click to skip the intro"
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
