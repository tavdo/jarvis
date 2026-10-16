#!/usr/bin/env node
// JARVIS preflight — a friendly, advisory check you run with `npm run setup`.
//
// It changes nothing and installs nothing. It looks at your machine, tells you
// what is ready and what is missing, and prints the command that starts
// JARVIS. Every check degrades to a single friendly line if something is not
// there, and the script always exits 0 — it is advice, not a gate.
//
// It reads the same settings the bridge does (bridge/config.mjs), so what it
// reports is what the bridge will see. It never prints a key.

import { existsSync } from 'node:fs';

const tick = '  ok  ';
const warn = ' note ';
const info = '  ·   ';

function line(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}

console.log('');
console.log('JARVIS preflight — checking your machine (nothing is changed)');
console.log('------------------------------------------------------------');

// --- Node version --------------------------------------------------------
const [major, minor] = process.versions.node.split('.').map(Number);
const nodeOk = major > 20 || (major === 20 && minor >= 12);
if (nodeOk) {
  line(tick, `Node.js ${process.versions.node} (20.12+ required).`);
} else {
  line(warn, `Node.js ${process.versions.node} is too old. Install Node 20.12 or newer (22 LTS recommended) from https://nodejs.org.`);
}

if (!existsSync('node_modules/openai')) {
  line(warn, 'Dependencies are not installed yet. Run `npm install` first, then run this again.');
  process.exit(0);
}

// Loaded after the version check: the settings file needs a recent Node.
const { ai, speech, tools } = await import('../bridge/config.mjs');
const { findBrowserPath } = await import('../bridge/chrome.mjs');
const { createProvider } = await import('../bridge/ai/index.mjs');

// --- The brain -----------------------------------------------------------
const chosen = ai[ai.provider];
line(info, `Brain: ${ai.provider} (JARVIS_AI_PROVIDER) · model ${chosen.model}${chosen.reasoningEffort ? ` · reasoning ${chosen.reasoningEffort}` : ''}.`);

if (ai.provider === 'openai') {
  if (!ai.openai.apiKey) line(info, '  Keys come from https://platform.openai.com/api-keys');
  else if (!/^sk-/.test(ai.openai.apiKey)) line(warn, 'OPENAI_API_KEY does not look like an OpenAI key (they start with "sk-").');
} else if (ai.provider === 'gemini') {
  if (!ai.gemini.apiKey) line(info, '  Free keys come from https://aistudio.google.com/apikey');
  else if (!/^(AIza|AQ\.)/.test(ai.gemini.apiKey)) line(warn, 'GEMINI_API_KEY does not look like a Google AI Studio key (they start with "AIza" or "AQ.").');
  line(info, '  On the free tier Google may use prompts to improve its products. No hosted web search: JARVIS searches in its own browser.');
} else if (ai.provider === 'vertex') {
  line(info, `  Project ${ai.vertex.project ?? '(not set)'} · location ${ai.vertex.location}. Signs in through: gcloud auth application-default login`);
}

const result = await createProvider(ai).check();
if (result.ok) line(tick, `${ai.provider} answered — credentials, model and billing all work. The key stays on the bridge.`);
else line(warn, result.error.message);

// --- Browser for JARVIS's own Chrome profile -----------------------------
const browser = findBrowserPath(tools.chrome.path);
if (browser) {
  line(tick, `Browser for web control: ${browser}`);
} else {
  line(info, 'No Chrome or Edge found — JARVIS can still search and open sites, but not drive pages.');
  line(info, '  Set JARVIS_CHROME_PATH if it is installed somewhere unusual.');
}

// --- Voice ---------------------------------------------------------------
if (speech.elevenlabs.apiKey) {
  line(tick, 'ElevenLabs key found — premium voice and Scribe transcription available.');
} else {
  line(info, 'No ElevenLabs key — JARVIS uses browser speech (completely fine).');
  line(info, '  Optional: ELEVENLABS_API_KEY for a better voice, or JARVIS_TTS_PROVIDER=openai to use OpenAI speech.');
}

// --- File access ---------------------------------------------------------
if (tools.readRoots.length) {
  line(info, `JARVIS may list and read text files in: ${tools.readRoots.join(', ')}`);
} else {
  line(info, 'File tools are off (JARVIS_READ_ROOTS=none or no folders found).');
}

// --- How to run ----------------------------------------------------------
console.log('');
console.log('To run JARVIS:');
console.log('  npm start               # the brain and the face together');
console.log('');
console.log('Then open the URL it prints in Chrome or Edge, click INITIALISE and say "Hey Jarvis".');
console.log('Anything that changes something (a click on a web page, deleting a file) asks you first.');
console.log('');

// Left to end on its own: process.exit() with the OpenAI connection still open
// crashes Node on Windows (0xC0000409) after everything has printed.
