import { useStore } from '../store'
import * as music from './music'
import { prefsNow, setPrefs, type Prefs } from './prefs'
import * as sfx from './sfx'

/** Sound settings, applied once at start-up (before power-on is fine). */
export function applyAudioPrefs() {
  const p = prefsNow()
  sfx.setVolume(p.sfxVolume)
  music.allow(p.music)
}

/** Save a change from the Settings page and apply it straight away. */
export function updatePrefs(patch: Partial<Prefs>) {
  setPrefs(patch)
  const p = prefsNow()
  if ('accent' in patch || 'reactorStyle' in patch || 'reactorSpin' in patch) {
    useStore.getState().applyUi({ accent: p.accent, reactor: { style: p.reactorStyle, spin: p.reactorSpin } })
  }
  if ('sfxVolume' in patch) sfx.setVolume(p.sfxVolume)
  if ('music' in patch) music.allow(p.music)
}
