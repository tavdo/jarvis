import * as bridge from './bridge'
import type { AskHandlers } from './bridge'
import type { Blade, Panel } from '../store'

export type { AskHandlers }
export type { ConnectionState, ConfirmRequest } from './bridge'

/** A line of conversation, as the app's own transcript keeps it. */
export type Msg = { role: 'user' | 'assistant'; content: string }

/**
 * The brain, as the rest of the app sees it.
 *
 * Always the local bridge: it holds the AI provider and every API key, so no
 * secret is ever bundled into this page. The bridge streams text and tool
 * events back over one WebSocket and keeps the conversation history itself.
 */

export const usingBridge = true

/** Conversation state lives in the bridge, so `history` is not sent. */
export async function ask(
  prompt: string,
  _history: Msg[],
  handlers: AskHandlers,
): Promise<{ text: string; tools: string[] }> {
  return bridge.ask(prompt, handlers)
}

export async function warm(): Promise<void> {
  await bridge.warmBridge()
}

/** The bridge reports its capabilities on connect, so the HUD subscribes. */
export function watchServers(fn: (servers: string[]) => void): void {
  bridge.watchServers(fn)
}

/** HUD panels are pushed mid-turn by the `display` tool, not returned by ask(). */
export function watchPanels(fn: (panel: Panel) => void): void {
  bridge.watchPanels(fn)
}

/** Blades — the big surface — arrive the same way, from the `blade` tool. */
export function watchBlades(fn: (blade: Blade) => void): void {
  bridge.watchBlades(fn)
}

/** Redressing the interface — theme, reactor, orbiting objects, effects. */
export function watchUi(fn: (op: string, args: any) => void): void {
  bridge.watchUi(fn)
}

/**
 * The bridge asking for a camera frame. The hardware is in the browser and the
 * model is behind the bridge, so this answers a request rather than a push.
 */
export function watchCapture(
  fn: (req: bridge.CaptureRequest) => Promise<bridge.CaptureResult>,
): void {
  bridge.watchCapture(fn)
}

/**
 * The bridge asking the user to approve an action that changes something.
 * Resolve with true only on an explicit yes.
 */
export function watchConfirm(
  fn: (req: bridge.ConfirmRequest) => Promise<boolean>,
  cancel: (id: string) => void,
): void {
  bridge.watchConfirm(fn, cancel)
}

/**
 * Barge-in. Stops the answer and settles whatever `ask()` call is outstanding,
 * so the caller's await always returns with the text so far.
 */
export function cancel(): void {
  bridge.cancel()
}

/** The older name for `cancel()`. */
export function interrupt(): void {
  cancel()
}

/** Whether the brain is reachable right now. */
export function isConnected(): boolean {
  return bridge.isConnected()
}

/** A reminder, timer or alarm the bridge says is due now. */
export function watchReminders(fn: (r: bridge.ReminderDue) => void): void {
  bridge.watchReminders(fn)
}

/** Connection state, for the UI: a drop also drops the conversation. */
export function watchConnection(
  fn: (state: bridge.ConnectionState) => void,
): void {
  bridge.watchConnection(fn)
}

/** Labels for the HUD's SYSTEMS rail. */
export function connectedLabels(): string[] {
  return bridge.bridgeServers()
}
