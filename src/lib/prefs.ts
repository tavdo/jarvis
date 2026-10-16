import { create } from 'zustand'

/**
 * The customisations that live in this browser and apply instantly: look,
 * intro, voice and sound. Kept in localStorage. Settings that need the bridge
 * (the brain, keys, permissions) are on the Settings page too, but are saved
 * by the bridge — see bridge/settings.mjs.
 *
 * Nothing here imports the store or the audio modules, so the store can read
 * the look at start-up without an import cycle; applyPrefs.ts does the rest.
 */

export type ReactorStyle = 'ring' | 'sphere' | 'wire'

export type Prefs = {
  /** One colour for the whole interface, or null to follow what he is doing. */
  accent: string | null
  reactorStyle: ReactorStyle
  /** Reactor rotation-rate multiplier. */
  reactorSpin: number
  /** Play the intro film at power-on. */
  intro: boolean
  /** Interface sound effects, 0..1. */
  sfxVolume: number
  /** The working-music cue while tools run. */
  music: boolean
  /** Gyro rings, the core lattice and pointer parallax around the reactor. */
  depth3d: boolean
  /** While he talks, only "stop" or his name cuts him off — not any sound. */
  stopWordsOnly: boolean
  /** Ignore sound much quieter than the user's own voice: a TV, music, the next room. */
  voiceFocus: boolean
}

export const PREF_DEFAULTS: Prefs = {
  accent: null,
  reactorStyle: 'ring',
  reactorSpin: 1,
  intro: true,
  sfxVolume: 0.5,
  music: true,
  depth3d: true,
  stopWordsOnly: true,
  voiceFocus: true,
}

const KEY = 'jarvis.prefs'

/** Saved values over the defaults, each checked, so a hand-edited or stale entry can't break the page. */
function load(): Prefs {
  let saved: Record<string, unknown> = {}
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}
  } catch {
    /* unreadable — defaults */
  }
  const p = { ...PREF_DEFAULTS }
  if (saved.accent === null || (typeof saved.accent === 'string' && /^#[0-9a-f]{6}$/i.test(saved.accent))) p.accent = saved.accent
  if (saved.reactorStyle === 'ring' || saved.reactorStyle === 'sphere' || saved.reactorStyle === 'wire') p.reactorStyle = saved.reactorStyle
  if (typeof saved.reactorSpin === 'number') p.reactorSpin = Math.min(3, Math.max(0, saved.reactorSpin))
  if (typeof saved.intro === 'boolean') p.intro = saved.intro
  if (typeof saved.sfxVolume === 'number') p.sfxVolume = Math.min(1, Math.max(0, saved.sfxVolume))
  if (typeof saved.music === 'boolean') p.music = saved.music
  if (typeof saved.depth3d === 'boolean') p.depth3d = saved.depth3d
  if (typeof saved.stopWordsOnly === 'boolean') p.stopWordsOnly = saved.stopWordsOnly
  if (typeof saved.voiceFocus === 'boolean') p.voiceFocus = saved.voiceFocus
  return p
}

export const usePrefs = create<Prefs>(() => load())

export function setPrefs(patch: Partial<Prefs>) {
  usePrefs.setState(patch)
  try {
    localStorage.setItem(KEY, JSON.stringify(usePrefs.getState()))
  } catch {
    /* storage full or blocked — the change still applies for this session */
  }
}

export const prefsNow = () => usePrefs.getState()
