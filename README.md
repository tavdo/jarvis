# J.A.R.V.I.S.

A browser voice assistant with an Iron Man holographic interface. Say
**"Hey Jarvis"**, he wakes, listens, and does real things — searches the web,
reads and drives web pages in his own browser, checks on your computer, opens
apps, reads files you've shared with him. The face is a web page (React + Vite +
Three.js + custom GLSL). The brain is an **OpenAI** or **Google Gemini** model,
called from a small Node server on your machine. Switching between them is one
line in `.env`.

**What you need:** one AI key — OpenAI (pay-as-you-go) or Gemini (free tier,
or Google Cloud credit through Vertex AI) — plus Node.js and Chrome or Edge. No
Claude account, no Claude Code. **ElevenLabs is an
optional add-on** for a better voice. Without it he speaks and listens through
the browser's own speech, and everything still works.

---

## Requirements

- **Node.js 20.12 or newer** (22 LTS recommended). It's a free installer from
  <https://nodejs.org>. Check with `node --version`.
- **One AI provider:** an OpenAI API key ([OpenAI setup](#openai-setup)), a
  Google AI Studio key ([Gemini setup](#gemini-setup-free-tier)), or a Google
  Cloud project ([Vertex AI setup](#vertex-ai-setup-google-cloud-credit)).
- **Google Chrome or Microsoft Edge**, in a **real browser window**. Embedded
  preview panes inside editors block the microphone, so the page loads and
  looks right but never hears you. JARVIS also needs WebGL.
- **Optional: an ElevenLabs API key** for a better voice and transcription.

Works on Windows, macOS and Linux.

---

## Install

```bash
git clone https://github.com/adewaskar/jarvis.git
cd jarvis
npm install
```

Then create your settings file from the example:

```powershell
# Windows (PowerShell)
Copy-Item .env.example .env
```

```bash
# macOS / Linux
cp .env.example .env
```

Open `.env`, choose the brain on the `JARVIS_AI_PROVIDER=` line (`openai`,
`gemini` or `vertex`) and fill in that provider's key or project, as described
below. Those are the only required settings. Then run the preflight check,
which changes nothing and makes one tiny request to prove the key, the model
and the billing all work:

```bash
npm run setup
```

---

## OpenAI setup

1. Sign in at <https://platform.openai.com> and add a payment method or credit
   under **Billing**. The API is billed separately from a ChatGPT subscription.
2. Create a key at <https://platform.openai.com/api-keys>.
3. Paste it into `.env`:

   ```
   JARVIS_AI_PROVIDER=openai
   OPENAI_API_KEY=sk-...
   ```

4. Optionally pick the model. **Each provider's model is set in one place** —
   `OPENAI_MODEL`, `GEMINI_MODEL` or `VERTEX_MODEL` in `.env`, read by
   `bridge/config.mjs`. Nothing else in the project names a model. The OpenAI
   default is `gpt-5-mini`, which is fast and cheap enough for voice.
   Any model that supports the Responses API with function calling works:

   ```
   OPENAI_MODEL=gpt-5-mini
   ```

`npm run setup` checks that the key is accepted, the model is available and the
account has credit.

## Gemini setup (free tier)

1. Sign in at <https://aistudio.google.com/apikey> with a Google account and
   click **Create API key**. It starts with `AIza`.
2. In `.env`:

   ```
   JARVIS_AI_PROVIDER=gemini
   GEMINI_API_KEY=AIza...
   ```

3. Optionally pick the model with `GEMINI_MODEL` (default `gemini-3.8-flash`)
   and the thinking level with `GEMINI_REASONING_EFFORT` (default `low`).

Things to know about this route:

- **The free tier has rate limits** (requests per minute and per day). When one
  is hit, JARVIS says so; it resets on its own. Turning on billing in AI Studio
  raises the limits.
- **On the free tier Google may use your prompts and answers to improve its
  products.** Use Vertex AI or a paid key if that matters to you.
- **Google Cloud credits (such as the $300 welcome credit) do not pay for AI
  Studio keys.** They pay for Vertex AI, below.
- **No hosted web search.** Google's compatible endpoint has no search tool,
  so JARVIS looks things up in his own browser instead (a DuckDuckGo results
  page, read with the browser tools). Answers are just as current, a little
  slower.

## Vertex AI setup (Google Cloud credit)

The same Gemini models through your Google Cloud project, billed to your Cloud
billing account — this is the route the $300 welcome credit pays for.

1. In the [Google Cloud console](https://console.cloud.google.com), create or
   pick a project and note its **project id**. Make sure a billing account
   (the one with the credit) is linked to it.
2. Enable the **Vertex AI API** for the project
   (<https://console.cloud.google.com/apis/library/aiplatform.googleapis.com>).
3. Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
   and sign in once. JARVIS uses this sign-in, so there is no key to paste:

   ```bash
   gcloud auth application-default login
   ```

4. In `.env`:

   ```
   JARVIS_AI_PROVIDER=vertex
   VERTEX_PROJECT=your-project-id
   ```

5. Optionally `VERTEX_LOCATION` (default `global`) and `VERTEX_MODEL` (default
   `google/gemini-3.8-flash` — note the `google/` prefix).

The bridge asks `gcloud` for a short-lived access token and refreshes it
itself. Like the free tier, this route searches the web through JARVIS's own
browser.

**Where the key lives.** Only the bridge (the Node process) reads
`OPENAI_API_KEY` or `GEMINI_API_KEY` (and only it asks `gcloud` for Vertex
tokens). The browser never receives them: Vite only passes
`VITE_`-prefixed variables to the page, and the bridge never sends the key over
the socket or puts it in a prompt. Error messages are scrubbed of anything that
looks like a key before they're logged or shown.

---

## Start

```bash
npm start          # runs the brain (bridge) and the face (Vite) together
```

Then open the URL it prints (http://localhost:5173) in **Chrome or Edge**, click
**INITIALISE**, allow the microphone, and say **"Hey Jarvis"**.

Prefer two terminals?

```bash
npm run bridge     # terminal 1 — the brain, on port 8787
npm run dev        # terminal 2 — the face, on port 5173
```

On startup the bridge prints its model and then whether the key was accepted,
e.g. `[jarvis] brain: openai · model gpt-5-mini` followed by
`[jarvis] openai ready — model gpt-5-mini is available`.

### Desktop app (Windows)

```bash
npm run desktop:install
```

puts a **JARVIS** icon on the desktop and in the Start menu, a **Stop JARVIS**
shortcut next to it, and a Startup entry so he starts (minimised, already
listening) when you sign in. `npm run desktop:install -- --no-autostart` skips
the Startup entry. Double-clicking the icon starts the brain and the face in the
background (no terminal windows) and opens JARVIS in its own app window, without
tabs or an address bar.

Closing the window does **not** stop him: he keeps listening for "Hey Jarvis"
in the background, with an icon in the system tray (double-click to show,
right-click → Quit to stop). Startup output goes to `~/.jarvis/jarvis.log`, and
if something fails a message box says so.

It is Chrome (or Edge) in app mode with its own profile, in which the
microphone and camera are allowed up front, so it never stops to ask (your
everyday browser is not changed). Electron is not used because Chrome's built-in
speech recognition — the free voice path — does not work inside it. Run the
command again if you move the JARVIS folder.

**Taskbar.** The window and the JARVIS shortcuts share one taskbar identity
(`scripts/taskbar.ps1`), so the window shows under the JARVIS reactor icon
rather than Chrome's. To keep him there, open JARVIS, right-click his taskbar
button and choose **Pin to taskbar**; the pinned icon starts everything, brain
included. Windows does not let programs pin themselves, so this one click is
yours.

### Voice and browser permissions

- The first time you click **INITIALISE**, the browser asks for the
  **microphone**. Allow it. If you clicked Block, click the padlock / site
  icon in the address bar → **Microphone → Allow**, then reload.
- On Windows, also check **Settings → Privacy & security → Microphone**:
  "Let desktop apps access your microphone" must be on for Chrome/Edge.
- The **camera** is only used when you ask JARVIS to look at something (or press
  **G** for gesture control). The interface always says when it's looking.
- Without a Picovoice key, the "Hey Jarvis" wake word uses the browser's speech
  recogniser (Chrome/Edge), which sends audio to the browser vendor for
  recognition. Add `VITE_PICOVOICE_ACCESS_KEY` for a fully offline wake word.

---

## How it works

```
  ┌─ browser (the face) ───────────────┐        ┌─ bridge (the brain) ──────────────┐
  │  "Hey Jarvis" wake word            │        │  Node · bridge/server.mjs         │
  │  local VAD  →  speech to text      │   ws   │  AI provider (OpenAI or Gemini)   │
  │  reactor UI (Three.js + GLSL)      │◄─────► │  conversation + tool loop         │
  │  text to speech                    │  8787  │  tool registry + validation       │
  │  heads-up display, confirm card    │        │  confirmation gate                │
  └────────────────────────────────────┘        └───────────────────────────────────┘
```

One turn goes like this: your voice → speech to text → the bridge → the AI
model → (tool calls → tool results → back to the model, as many rounds as
needed) → the streamed answer → text to speech.

**The pieces on the bridge:**

| File | Role |
|---|---|
| `bridge/config.mjs` | Every setting, read in one place. Loads `.env` / `.env.local`. |
| `bridge/ai/provider.mjs` | `AIProvider`, the interface any brain implements, and `AIError`. |
| `bridge/ai/index.mjs` | Builds the provider named by `JARVIS_AI_PROVIDER`. |
| `bridge/ai/openai.mjs` | `OpenAIProvider`, which streams from the Responses API and maps errors. |
| `bridge/ai/chat-completions.mjs` | `ChatCompletionsProvider`, for services with an OpenAI-compatible Chat Completions API. |
| `bridge/ai/google.mjs` | Gemini (AI Studio key) and Vertex AI (gcloud sign-in) on top of it, with Google's error messages. |
| `bridge/agent.mjs` | `Conversation`, which runs the tool loop and keeps short-term memory. |
| `bridge/persona.mjs` | The system instructions (JARVIS's persona and rules). |
| `bridge/tools/registry.mjs` | Tool definitions, argument validation and the confirmation gate. |
| `bridge/speech/*` | `TextToSpeechProvider` / `SpeechToTextProvider`: ElevenLabs, OpenAI. |

To swap the brain for another provider, implement `AIProvider` and add it to
`bridge/ai/index.mjs`. Nothing else changes.

**Memory.** The bridge keeps the last few exchanges (your question and his
spoken answer, 12 by default, `JARVIS_HISTORY_TURNS`) so follow-ups work. Tool
output, page text and images stay within the turn that produced them and aren't
resent. Memory lasts as long as the page is connected; reloading starts fresh.
Requests are stateless: the whole relevant conversation is sent each time and,
on OpenAI, with `store: false` so it is asked not to keep them.

### The voice pipeline

- **Detection is local.** An energy-based voice-activity detector
  (`src/lib/vad.ts`) decides when you're speaking, which is what makes
  **barge-in** work. By default only **"stop"** (also "enough", "cancel",
  "გაჩერდი") or **his name** cuts him off — a TV or another voice does not, and
  "Jarvis, …" stops him and asks the new question. Settings → Voice & sound can
  switch back to "any speech interrupts".
- **Only your voice.** Each time you say his name he notes how loud you are;
  speech far quieter than that (a TV, music, someone across the room) is ignored
  before it is even transcribed. It works on loudness, not a voiceprint, so a
  second person sitting right at the microphone still counts as you. With it on,
  Chrome's automatic gain control is off, which keeps the loudness comparison
  honest. Toggle in Settings → Voice & sound.
- **Transcription** is chosen at boot from the bridge's `/health`: ElevenLabs
  Scribe or OpenAI transcription if configured, otherwise the browser's
  `SpeechRecognition`.
- **Speaking** uses ElevenLabs or OpenAI speech if configured, otherwise the
  browser's `speechSynthesis` (or the in-browser Kokoro voice, with
  `VITE_TTS_ENGINE=kokoro`).

Pick providers with `JARVIS_TTS_PROVIDER` / `JARVIS_STT_PROVIDER`
(`auto` | `elevenlabs` | `openai` | `browser`). `auto` uses ElevenLabs when its
key is set and the browser otherwise. OpenAI speech is opt-in because it bills
your OpenAI account per sentence (it needs `OPENAI_API_KEY` even when the brain
is Gemini).

---

## How tools work

The model never runs anything itself. It asks for a tool by name with JSON
arguments. The bridge looks the tool up in its registry, **validates the
arguments against the tool's schema** (anything malformed is refused and the
model is told why), asks you first if the tool needs confirmation, runs it, and
hands the result back to the model.

| Group | Tools | Asks first? |
|---|---|---|
| **Web** | OpenAI hosted `web_search`; on Gemini, a search page read in JARVIS's browser | no |
| **Browser** (JARVIS's own Chrome/Edge profile) | `chrome_status`, `chrome_tabs`, `chrome_navigate`, `chrome_read_page`, `chrome_page_text`, `chrome_find`, `chrome_screenshot`, `chrome_scroll`, `chrome_console`, `chrome_network`, `chrome_new_tab`, `chrome_close_tab` | no |
| | `chrome_click`, `chrome_type`, `chrome_key`, `chrome_form_input` | **yes, every time** |
| **This computer** | `system_info`, `list_applications`, `open_application` (anything in the Start menu), `open_website` (http/https only), `take_screenshot` (when you ask him to look at or work on your screen), `list_files`, `read_file` (text only; key and credential files refused) | no |
| | `create_folder`, `copy_item`, `write_file` making a **new** text file — they only add, never replace | no |
| | `write_file` replacing or adding to a file, `move_item`, `recycle_file` (to the recycle bin, never a permanent delete) | **yes, every time** |
| | Windows, Program Files, AppData and JARVIS's own folder can't be changed at all | — |
| **PC control** (`JARVIS_PC_CONTROL`) | `list_windows`, `window_control` (focus, minimise, maximise), `volume`, `media_control`, `lock_screen`, `cancel_shutdown`, `mouse` moving and scrolling | no |
| | `mouse` clicking and dragging anywhere on screen, `close_window`, `type_text`, `press_keys`, `power` (sleep, restart, shut down) | **yes, every time** |
| | `run_command` (`JARVIS_ALLOW_COMMANDS`): one PowerShell or cmd command, shown to you in full; secrets are stripped from its environment and redacted from its output. With `as_admin` it runs as administrator, and Windows' own UAC prompt asks you as well | **yes, every time** |
| **Display** | `display`, `blade`, `probe_url`, which put panels and images on the HUD | no |
| **Interface** | `ui_theme`, `ui_reactor`, `ui_orbit`, `ui_chrome`, `ui_effect`, `ui_screen`, `ui_reset` | no |
| **Camera** | `look`, `watch` (announced on screen while in use) | no |
| **Assistant** | `remember`, `forget` (one or two facts), `set_reminder`, `list_reminders`, `cancel_reminder`, `read_clipboard`, `write_clipboard`, `weather_forecast`, `news_headlines`, `play_music`, `morning_briefing`, `run_routine` | no |
| | `forget` with three or more facts at once | **yes** |

**The browser.** The first time a page tool is used, the bridge launches Chrome
(or Edge) with a **separate JARVIS profile** in `~/.jarvis/chrome-profile` and
controls it over the DevTools protocol on `localhost:9222`. Your everyday
browser, its logins and its cookies aren't touched. Sign in to sites inside
that window if you want JARVIS to use them.

A few things you can say:

- *"What's happening in AI this week?"*
- *"How much memory and disk space do I have?"*
- *"Open the calculator."*
- *"Go to Hacker News and read me the top three stories."*
- *"What's in my Downloads folder?"*
- *"Write my shopping list to a file on the desktop."*
- *"Click the Play button in Spotify."* (he takes a screenshot, finds it, and asks before clicking)
- *"Install VLC."* (a `winget` command as administrator — he asks, then Windows asks)
- *"Make it red, hide the transcript, and pulse the reactor."*

### Everyday assistant

- **Memory.** *"Remember that my sister's birthday is the third of May."* Facts
  are kept in `~/.jarvis/memory.json` (up to 100) and given to the brain in
  every conversation, so he knows them after a restart. *"Forget that"*, or
  delete them on the Settings page. Anything that looks like a password, key,
  PIN or card number is refused.
- **Reminders, timers, alarms.** *"Remind me at six to call mum"*, *"a ten
  minute timer for the pasta"*, *"wake me at seven on weekdays"*. The bridge
  holds them in `~/.jarvis/reminders.json`, so they survive restarts; when one
  is due he says it aloud in every open window (waiting for an answer in
  progress to finish) and Windows shows a notification, even with the window
  closed. One that fell due while JARVIS was off is said as soon as he starts.
- **Morning briefing.** *"Good morning, Jarvis."* The time, the weather for your
  city, what is due today, anything wrong with the PC and two headlines.
- **Weather and news.** *"Will it rain tomorrow?"* (Open-Meteo, no key) and
  *"Any news about Formula 1?"*, *"news from Georgia"* (Google News; Civil.ge
  and Netgazeti for Georgia — Google has no Georgian edition).
- **Clipboard.** *"Translate what I copied"*, *"summarise this"*. He only reads
  it when asked; a password or key on the clipboard is withheld from the model.
  He copies something back only when you say so.
- **Music.** *"Play Bohemian Rhapsody"* finds the best YouTube match and plays it
  in your browser; *"on Spotify"* opens Spotify's search for it (the app if
  installed, otherwise the web player) and you press play.
- **Routines.** On the Settings page, give a routine a name (*gaming mode*) and
  its steps in plain words, one per line. Say the name and he carries them out
  with his usual tools; anything risky still asks first.

### Georgian

Set **Language** to **ქართული** on the Settings page (or `JARVIS_LANGUAGE=ka`)
and he listens for Georgian, answers in Georgian and says "ბატონო" for "sir";
his name works as *ჯარვის*, and *კი* / *არა* answer a confirmation. In English
mode he still answers Georgian with Georgian. Speaking Georgian needs the
ElevenLabs key: the bridge switches to ElevenLabs' `eleven_v3` model for any
Georgian sentence, because the faster Flash model reads Georgian script as a
foreign-accented transliteration. v3 spends more credits per character.

---

## Security and confirmations

- **Every risky action asks you first.** Clicking or typing (on a web page or
  anywhere on screen), pressing keys, replacing, moving or deleting files,
  closing windows, power and every command bring up a red **confirmation card**
  with exactly what will happen, e.g. *"Delete report.pdf?"*, *"Click in
  Spotify?"* or the full command text. JARVIS also says "Your confirmation is
  required, sir." Actions that only add something — a new folder, a copy, a new
  file — and moving the pointer or scrolling run straight away.
- **Answer** by saying **"yes"** / **"no"**, pressing **Y** / **Enter** or
  **N**, or clicking **Confirm** / **Deny**. Silence for 30 seconds
  (`JARVIS_CONFIRM_TIMEOUT_MS`), pressing **Escape**, or closing the page all
  count as **no**.
- **The model can't skip it.** The gate is in the tool registry on the bridge,
  in code, not in the prompt; which calls need it is decided there from the
  checked arguments. There's no "allow everything" switch.
- **Commands are shown, one at a time.** `run_command` runs a single command
  you have read and approved; administrator commands also need Windows' UAC
  prompt, which JARVIS cannot click. Commands never see JARVIS's keys.
- **Files have limits.** The file tools reach the drives in `JARVIS_READ_ROOTS`
  (default: every drive; `none` turns them off). Windows, Program Files,
  AppData and JARVIS's own folder can't be changed, real paths are resolved and
  checked, and key/credential files (`.env`, SSH keys, password stores…) are
  refused everywhere.
- **The mouse can't approve itself.** JARVIS's own window is never clicked —
  it steps aside instead — so a click can't press his Confirm button.
- **Tool calls are untrusted input.** Every argument is schema-validated before
  anything runs; URLs must be http/https; element references must match the
  page's own ids.
- **Web pages and files are data, not instructions.** Page text and file
  contents are labelled that way to the model, and the persona tells it never
  to follow instructions found in them or put private data in URLs.
- **The bridge is local.** The WebSocket only accepts local dev origins
  (`JARVIS_ALLOWED_ORIGINS` to add more). `/file` serves images only, from your
  home and temp folders. `/img` and `/media` refuse private and loopback
  addresses (SSRF guard). A strict CSP in `index.html` and DOMPurify sanitise
  model-authored panels.
- **Passcode lock.** After the intro, the **Secure access** screen asks for a
  six-digit passcode (the first start asks you to choose one, twice). Type it
  or tap the keypad; the sixth digit submits, Backspace takes one back. Until
  it's right the microphone stays off, typed questions are ignored, and the
  bridge refuses questions, settings, memory and reminders. The bridge checks
  the code and keeps only a salted scrypt hash in `~/.jarvis/passcode.json`.
  Five wrong in a row lock the keypad for 30 seconds, doubling with each
  further miss (up to 15 minutes). Closing or reloading the window locks him
  again. Change it, turn it off or **LOCK NOW** under Settings → Security.
  Forgot it? Quit JARVIS, delete `~/.jarvis/passcode.json`, and set a new one.
- **API keys stay on the bridge**, whichever provider you use (see
  [OpenAI setup](#openai-setup)). Logs and error messages are scrubbed of
  anything that looks like an OpenAI or Google key or token.

---

## Controls

| Key / phrase | Does |
|---|---|
| **"Hey Jarvis"** | Wake him |
| **Space** | Talk without the wake word |
| **"Stop"** or **"Jarvis"** | Interrupt him mid-sentence (barge-in) |
| **"Yes"** / **"No"**, **Y** / **Enter** / **N** | Answer a confirmation |
| **V** | Cycle the browser voice |
| **G** | Gesture control (camera) on/off |
| **Escape** | Stand down (and deny any pending confirmation) |
| **D** | Live diagnostics panel |
| **T** | One-line audio self-test |

---

## The interface

By default JARVIS runs as a green holographic **command centre**
(`src/ui/command/`): a world-view globe, security and mission panels, live
data streams, system diagnostics gauges, sensors, an audio monitor and
analytics around the reactor, which frames a turning globe at the centre.
Every panel animates, and wherever there is a real number it is the real
number — CPU, RAM, disk and (with an NVIDIA card) GPU load, temperature and
power come from the bridge's `/stats` endpoint; the chips, processes and
LISTENING / THINKING / READY lights follow what JARVIS is doing; recent
activity is what was actually said and done.

- Type into the prompt bar and press **Enter** to ask without speaking. The
  ANALYZE / RESEARCH / PLAN / CREATE / AUTOMATE buttons start a sentence for
  you; the mic button is the same as **Space**.
- Set `JARVIS_WEATHER_CITY` to show local weather (from Open-Meteo, no key).
- `VITE_JARVIS_HUD=classic` brings back the original cyan interface.

The tabs along the top open full pages (the reactor dims behind them):

| Tab | What it shows |
|---|---|
| **Overview** | The command centre above |
| **Intelligence** | The brain (provider, model, state), his personality, tool groups, recent conversation |
| **Systems** | Hardware gauges, two minutes of processor load, the bridge link, permissions |
| **Analytics** | Session totals, which tools were used and how often, load trend, the full activity log |
| **Tools** | Every tool he has, searchable, marked *asks you first* or *runs directly* |
| **Communication** | The conversation as a chat, with a text box, SEND and TALK |
| **Settings** | Customise JARVIS — below |
| **Secure access** | Shown instead of the tabs until the passcode is entered |

### Settings

- **Identity** — what he calls you, standing instructions he keeps in every
  conversation (a tone, a habit; they never override confirmations), the
  language (English or Georgian) and the weather city.
- **Brain** — OpenAI or Gemini, the model, and the API keys. Keys are
  write-only: they go into the git-ignored `.env` (or `.env.local` if the key
  is already there), and the page only ever learns whether one is set.
- **Permissions** — PC control and commands on or off. Risky actions always ask.
- **Memory**, **Reminders**, **Routines** — what he remembers (with FORGET),
  what is set (with CANCEL), and your routines to add, edit and remove. These
  apply from his next answer, without a restart, and the lists keep up with
  what you tell him by voice.
- **Appearance** — interface colour, reactor style and spin, 3D depth (gyro
  rings and a core lattice that turn to follow the mouse), the intro film.
- **Voice & sound** — the browser voice (with a test), effects volume, music,
  what may interrupt him, and only-my-voice.
- **Security** — change the passcode, turn it off or on, and LOCK NOW.

Identity, brain and permissions are saved by the bridge to
`~/.jarvis/settings.json`, which wins over `.env` but not over your shell. On
**SAVE & APPLY** the bridge restarts itself (under `npm start` or the desktop
app) and is back in a couple of seconds. The look, voice and sound apply at
once and are kept in the browser. The bridge's `/settings` and `/assistant`
endpoints answer only JARVIS's own pages (they check the `Origin`), and JARVIS's browser tools
refuse to open his own interface, so the model cannot change its own settings.

---

## The boot sequence

Power-up plays the intro film `src/assets/jarvis-intro-v2-green.mp4` full
screen, with its own soundtrack (`src/ui/Boot.tsx`). The live interface takes
over when the film ends — the boot lasts exactly as long as the clip, so you
can swap in a different video by changing the import in `Boot.tsx`. Click the
film to skip it. The interface is hidden while it plays; rendering it behind
the video made playback stall.

---

## Environment variables

All settings live in `.env` (copy `.env.example`, which documents every one).
Values set in your shell override the file. Whatever you change on the
Settings page is kept in `~/.jarvis/settings.json` and wins over `.env`.

### Bridge (server-side, may hold secrets)

| Variable | Default | Effect |
|---|---|---|
| `JARVIS_AI_PROVIDER` | `openai` | The brain: `openai`, `gemini` or `vertex` |
| `OPENAI_API_KEY` | — | **Required for `openai`.** Your OpenAI key |
| `OPENAI_MODEL` | `gpt-5-mini` | The OpenAI model, set only here |
| `OPENAI_REASONING_EFFORT` | `low` for reasoning models | `minimal`/`low`/`medium`/`high`/`off` |
| `OPENAI_WEB_SEARCH` | `true` | OpenAI's hosted web search tool |
| `OPENAI_MAX_OUTPUT_TOKENS` | `4096` | Cap on each reply |
| `OPENAI_BASE_URL` | — | Proxy or compatible gateway |
| `GEMINI_API_KEY` | — | **Required for `gemini`.** Google AI Studio key |
| `GEMINI_MODEL` | `gemini-3.8-flash` | The Gemini model, set only here |
| `GEMINI_REASONING_EFFORT` | `low` | `low`/`medium`/`high`/`off` (Gemini and Vertex) |
| `GEMINI_MAX_OUTPUT_TOKENS` | `4096` | Cap on each reply (Gemini and Vertex) |
| `GEMINI_BASE_URL` | Google's endpoint | Proxy for the OpenAI-compatible endpoint |
| `VERTEX_PROJECT` | `GOOGLE_CLOUD_PROJECT` | **Required for `vertex`.** Google Cloud project id |
| `VERTEX_LOCATION` | `global` | Vertex AI region |
| `VERTEX_MODEL` | `google/gemini-3.8-flash` | The Vertex model, set only here |
| `JARVIS_MAX_TOOL_STEPS` | `12` | Model calls per question |
| `JARVIS_HISTORY_TURNS` | `12` | Exchanges remembered (0 = none) |
| `JARVIS_TTS_PROVIDER` / `JARVIS_STT_PROVIDER` | `auto` | `auto`/`elevenlabs`/`openai`/`browser` |
| `ELEVENLABS_API_KEY` | — | Optional ElevenLabs voice + Scribe |
| `JARVIS_VOICE_ID` | George | ElevenLabs voice id |
| `JARVIS_LANGUAGE` | `en` | `en` or `ka` (Georgian): what he listens for and answers in |
| `OPENAI_TTS_MODEL` / `OPENAI_TTS_VOICE` / `OPENAI_STT_MODEL` | `gpt-4o-mini-tts` / `onyx` / `gpt-4o-mini-transcribe` | OpenAI speech |
| `JARVIS_CONFIRM_TIMEOUT_MS` | `30000` | Wait for yes/no before treating it as no |
| `JARVIS_READ_ROOTS` | every drive | Folders the file tools may use; `none` disables |
| `JARVIS_PC_CONTROL` | `true` | Windows, keyboard, volume, media and power tools |
| `JARVIS_ALLOW_COMMANDS` | `true` | The confirmed `run_command` tool |
| `JARVIS_WEATHER_CITY` | — | City for the interface's weather readout |
| `JARVIS_USER_NAME` | — (sir) | What JARVIS calls you |
| `JARVIS_INSTRUCTIONS` | — | Standing instructions, up to 2000 characters |
| `JARVIS_CHROME_PATH` | auto-detected | Chrome or Edge to drive |
| `JARVIS_CHROME_PROFILE` | `~/.jarvis/chrome-profile` | JARVIS's browser profile |
| `JARVIS_CHROME_DEBUG_PORT` | `9222` | DevTools port |
| `JARVIS_CHROME_AUTOLAUNCH` | `true` | Launch the browser when first needed |
| `JARVIS_BRIDGE_PORT` | `8787` | WebSocket + HTTP port |
| `JARVIS_ALLOWED_ORIGINS` | local dev | Extra WebSocket origins |
| `JARVIS_ALLOW_NO_ORIGIN` | off | Accept clients with no `Origin` header |
| `JARVIS_FILE_ROOTS` | — | Extra roots `/file` may serve images from |
| `JARVIS_DEBUG` | off | Verbose logs |

### Frontend (`VITE_`, compiled into the page, never secrets)

| Variable | Effect |
|---|---|
| `VITE_BRIDGE_URL` | Where to reach the bridge (default `ws://localhost:8787`) |
| `VITE_TTS_ENGINE` | `system` or `kokoro` |
| `VITE_KOKORO_VOICE` | Voice for the Kokoro engine |
| `VITE_USE_ELEVENLABS` | Always prefer the bridge's voice |
| `VITE_PICOVOICE_ACCESS_KEY` | Offline wake word (client-side key by design) |
| `VITE_JARVIS_HUD` | `command` (default) or `classic` |

---

## Troubleshooting

**The status says which provider and model are in use.** `npm run setup` and the
bridge's first log lines name them; check `JARVIS_AI_PROVIDER` if it's the
wrong one. The bridge reads `.env` only at startup, so restart `npm start`
after any change.

**"OPENAI_API_KEY is not set."** Create `.env` from `.env.example`, set the key,
and restart `npm start`.

**"OpenAI rejected the API key."** The key is wrong, revoked, or was pasted with
a missing character. Make a new one at <https://platform.openai.com/api-keys>.

**"The model … is not available to this API key."** Set `OPENAI_MODEL` to a
model your account can use (`npm run setup` checks it).

**"Out of credit or over its quota."** Add credit under Billing on
platform.openai.com. ChatGPT Plus doesn't cover API usage.

**"OpenAI is rate limiting requests."** Too many requests in a short time. Wait a moment, or raise
your account's usage tier.

**"GEMINI_API_KEY is not set."** Set `JARVIS_AI_PROVIDER=gemini` and
`GEMINI_API_KEY=` in `.env` (key from <https://aistudio.google.com/apikey>),
then restart.

**"Google rejected the credentials."** On `gemini`, the key is wrong or was
deleted; make a new one. On `vertex`, the sign-in expired; run
`gcloud auth application-default login` again.

**"The Gemini free tier limit was reached."** Wait a minute (or until the next
day for the daily limit), turn on billing in AI Studio, or switch to `vertex`.

**"Vertex AI needs the Google Cloud CLI."** Install it from
<https://cloud.google.com/sdk/docs/install>, open a new terminal, and run
`gcloud auth application-default login`.

**"Vertex AI refused … Check that the Vertex AI API is enabled."** Enable the
Vertex AI API on the project and make sure billing is linked to it.

**"Gemini is not available from here."** Google doesn't serve Gemini in every
country; use OpenAI or Vertex AI.

**I can't hear him, or he can't hear me.** Press **D** for the diagnostics panel
and **T** for an audio self-test. You must be in Chrome or Edge, in a real
window, with the microphone allowed (see
[Voice and browser permissions](#voice-and-browser-permissions)).

**"Microphone access denied."** Allow it from the address-bar site icon and
reload. On Windows, also check the OS microphone privacy setting.

**Browser tools fail / "could not start Chrome".** Install Chrome or Edge, or
set `JARVIS_CHROME_PATH`. If port 9222 is taken by another debugger, set
`JARVIS_CHROME_DEBUG_PORT`.

**A confirmation card appears and I didn't expect it.** That's the gate doing
its job. Say "no" or press **N**. JARVIS won't retry unless you ask again.

**Bridge not reachable / "port 8787 is already in use".** Another bridge is probably
still running. Close it (or the terminal running it) and start again, or set
`JARVIS_BRIDGE_PORT` and `VITE_BRIDGE_URL` to another port.

---

## Credits & licence

MIT.

The boot sound and any tracks in `public/audio/` ship with the project for the
demo. If you go on to monetise something built on this, clearing the rights to
that audio is your responsibility.
