import { BRIDGE_HTTP_URL } from '../config'
import { sessionHeaders } from './lock'

/**
 * The bridge's side of the Settings page (bridge/settings.mjs). API keys only
 * ever travel one way: the page can send a new one, and learns back nothing
 * but whether one is set.
 */

export type BridgeSettings = {
  provider: 'openai' | 'gemini' | 'vertex'
  openaiModel: string
  geminiModel: string
  weatherCity: string
  pcControl: boolean
  commands: boolean
  userName: string
  instructions: string
  /** The ElevenLabs voice he speaks with, when an ElevenLabs key is set. */
  voiceId: string
  /** What he listens for and answers in. */
  language: 'en' | 'ka'
}

export type KeyName = 'openai' | 'gemini' | 'elevenlabs'

export type SettingsView = BridgeSettings & {
  keys: Record<KeyName, boolean>
  platform: string
  /** Whether saving restarts the brain by itself (it does under npm start and the desktop app). */
  restartable: boolean
  /** `checked` is false until the bridge has tried the key and model once after starting. */
  brain: { provider: string; model: string; ready: boolean; checked: boolean; error: string | null }
}

export async function loadSettings(): Promise<SettingsView> {
  const res = await fetch(`${BRIDGE_HTTP_URL}/settings`, { cache: 'no-store', headers: sessionHeaders(), signal: AbortSignal.timeout(4000) })
  if (!res.ok) throw new Error(`The bridge answered ${res.status}.`)
  return (await res.json()) as SettingsView
}

export async function saveSettings(update: {
  settings: Partial<BridgeSettings>
  keys: Partial<Record<KeyName, string>>
}): Promise<{ changed: string[]; restarting: boolean }> {
  const res = await fetch(`${BRIDGE_HTTP_URL}/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeaders() },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(8000),
  })
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; changed?: string[]; restarting?: boolean }
  if (!res.ok || !body.ok) throw new Error(body.error ?? `The bridge answered ${res.status}.`)
  return { changed: body.changed ?? [], restarting: Boolean(body.restarting) }
}

/* What he keeps between conversations (bridge/assistant.mjs). Changes apply on his next turn, no restart. */

export type MemoryItem = { id: string; text: string; at: number }
export type ReminderItem = { id: string; kind: 'reminder' | 'timer' | 'alarm'; text: string; due: number; repeat: 'none' | 'daily' | 'weekdays' }
export type Routine = { name: string; steps: string }
export type AssistantData = { memories: MemoryItem[]; reminders: ReminderItem[]; routines: Routine[] }

export async function loadAssistant(): Promise<AssistantData> {
  const res = await fetch(`${BRIDGE_HTTP_URL}/assistant`, { cache: 'no-store', headers: sessionHeaders(), signal: AbortSignal.timeout(4000) })
  if (!res.ok) throw new Error(`The bridge answered ${res.status}.`)
  return (await res.json()) as AssistantData
}

export async function changeAssistant(
  change: { op: 'forget' | 'cancel'; id: string } | { op: 'routines'; routines: Routine[] },
): Promise<AssistantData> {
  const res = await fetch(`${BRIDGE_HTTP_URL}/assistant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeaders() },
    body: JSON.stringify(change),
    signal: AbortSignal.timeout(6000),
  })
  const body = (await res.json().catch(() => ({}))) as AssistantData & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `The bridge answered ${res.status}.`)
  return body
}

/** Wait for the bridge to come back after a restart and finish checking its brain. */
export async function waitForBridge(timeoutMs = 30_000): Promise<SettingsView> {
  const deadline = Date.now() + timeoutMs
  await new Promise((r) => setTimeout(r, 800))
  for (;;) {
    try {
      const view = await loadSettings()
      if (view.brain.checked || Date.now() > deadline) return view
    } catch (err) {
      if (Date.now() > deadline) throw err
    }
    await new Promise((r) => setTimeout(r, 700))
  }
}
