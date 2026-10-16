/**
 * The hand-off between the intro film (ui/Boot.tsx) and the power-up in App.
 *
 * The clip sets the pace: App waits on `introFinished()` rather than a fixed
 * timer, so a different file can be dropped into src/assets without touching
 * a constant somewhere else.
 */

const DONE = 'jarvis:intro-done'

/**
 * Resolves when the intro has played out, been skipped, or failed to play.
 *
 * Call it BEFORE entering the boot phase: a clip that fails to load reports
 * immediately, and a listener added afterwards would wait for the cap instead.
 * The cap only matters if the video stalls without ever erroring.
 */
export function introFinished(capMs = 30_000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(cap)
      window.removeEventListener(DONE, done)
      resolve()
    }
    const cap = setTimeout(done, capMs)
    window.addEventListener(DONE, done)
  })
}

export function reportIntroDone() {
  window.dispatchEvent(new Event(DONE))
}
