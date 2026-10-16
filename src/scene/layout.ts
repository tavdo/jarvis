import { HUD_STYLE, REACTOR_LAYOUT } from '../config'

/**
 * Ring diameter as a fraction of the SHORTER viewport dimension.
 *
 * Framing has to be driven by the viewport rather than by a constant, because
 * the plane is a fixed size in world units while the frame is not: the same
 * scale that leaves a comfortable margin on a 16:9 monitor runs the ring off
 * both edges of a portrait window.
 */
export const FIT = HUD_STYLE === 'command' ? REACTOR_LAYOUT.fit : 0.6
/** How far above centre the ring sits, as a fraction of the viewport height. */
export const LIFT = HUD_STYLE === 'command' ? 0.5 - REACTOR_LAYOUT.top : 0

/** How much bigger the ring grows while it frames the passcode card. */
export const LOCK_GROW = 0.6

/** The ring's radius in world units at reactor scale 1, for anything drawn around it. */
export function ringRadius(viewport: { width: number; height: number }): number {
  return FIT * 0.5 * Math.min(viewport.width, viewport.height)
}
