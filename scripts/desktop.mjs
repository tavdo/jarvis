/**
 * JARVIS as a desktop app (Windows): what the desktop icon, the tray icon and
 * Windows sign-in run.
 *
 *   desktop.mjs           open JARVIS — start him if he is not running, and
 *                         bring his window back if it is already open
 *   desktop.mjs --login   the same at sign-in, then minimise the window once
 *                         he is up, so he listens without getting in the way
 *   desktop.mjs --stop    stop everything: brain, face, window and tray icon
 *
 * The brain and the face run in the background and outlive the window: closing
 * it leaves JARVIS running, with an icon by the clock to reopen or quit him.
 * Listening is done by the page, so he hears "Hey Jarvis" while the window is
 * open or minimised, not after it has been closed.
 *
 * Why a Chrome app window and not Electron: the free voice path is Chrome's
 * own speech recognition, which does not work inside Electron, and Electron
 * would be a large dependency for what is otherwise the same page.
 *
 * It runs hidden (see desktop-install.mjs), so output goes to
 * ~/.jarvis/jarvis.log and failures are shown in a message box.
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const LAUNCHER = fileURLToPath(import.meta.url)
const ROOT = join(dirname(LAUNCHER), '..')
const HOME = join(homedir(), '.jarvis')
const LOG = join(HOME, 'jarvis.log')
const PID_FILE = join(HOME, 'servers.pid')
const STARTING = join(HOME, 'starting.lock')
const ICON = join(HOME, 'jarvis.ico')
const TRAY = join(ROOT, 'scripts', 'tray.ps1')
const TASKBAR = join(ROOT, 'scripts', 'taskbar.ps1')
const WINDOW_PROFILE = join(HOME, 'app-window')
const BRIDGE_PORT = 8787
const FACE = 'http://localhost:5173/'
const BRIDGE = `http://localhost:${BRIDGE_PORT}/health`
const STARTUP_TIMEOUT_MS = 90_000
/** After sign-in, how long the boot sequence gets on screen before he is tucked away. */
const LOGIN_SHOW_MS = 12_000

const flags = process.argv.slice(2)
const LOGIN = flags.includes('--login')
const STOP = flags.includes('--stop')

mkdirSync(HOME, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const psString = (s) => `'${String(s).replace(/'/g, "''")}'`

function powershell(script) {
  try {
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    return ''
  }
}

function alert(message) {
  powershell(
    `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${psString(message)}, 'J.A.R.V.I.S.') | Out-Null`,
  )
}

async function faceUp() {
  try {
    const res = await fetch(FACE, { signal: AbortSignal.timeout(2_000) })
    return res.ok && (await res.text()).includes('J.A.R.V.I.S.')
  } catch {
    return false
  }
}

async function bridgeUp() {
  try {
    const res = await fetch(BRIDGE, { headers: { origin: 'http://localhost:5173' }, signal: AbortSignal.timeout(2_000) })
    return res.ok
  } catch {
    return false
  }
}

/** How many JARVIS pages are connected to the bridge. */
async function connectedPages() {
  try {
    const res = await fetch(BRIDGE, { headers: { origin: 'http://localhost:5173' }, signal: AbortSignal.timeout(2_000) })
    return (await res.json()).clients ?? 0
  } catch {
    return 0
  }
}

function findChrome() {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
  for (const root of roots) {
    for (const exe of ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']) {
      const path = join(root, exe)
      if (existsSync(path)) return path
    }
  }
  return null
}

// --- The JARVIS window ----------------------------------------------------------

/**
 * Show (9, restore and bring forward) or minimise (6) the open JARVIS window.
 * Returns false when there is none. Found by its exact title, which only the
 * app window has — a JARVIS tab in a normal browser ends "- Google Chrome".
 */
function windowAction(cmd) {
  return (
    powershell(
      `$p = Get-Process chrome, msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'J.A.R.V.I.S.' } | Select-Object -First 1
       if (-not $p) { 'NONE'; exit }
       Add-Type 'using System; using System.Runtime.InteropServices; public static class JW { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }'
       [void][JW]::ShowWindow($p.MainWindowHandle, ${Number(cmd)})
       if (${Number(cmd)} -eq 9) { [void][JW]::SetForegroundWindow($p.MainWindowHandle) }
       'OK'`,
    ) === 'OK'
  )
}

/**
 * Allow the microphone and camera for the JARVIS page in the window's own
 * profile before it opens, so it never stops to ask. Only this profile and only
 * this page; everyday Chrome is untouched. An unreadable Preferences file is
 * left alone rather than replaced.
 */
function grantMedia() {
  const file = join(WINDOW_PROFILE, 'Default', 'Preferences')
  let prefs = {}
  if (existsSync(file)) {
    try {
      prefs = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return
    }
  }
  const exceptions = (((prefs.profile ??= {}).content_settings ??= {}).exceptions ??= {})
  // Chrome's clock: microseconds since 1601.
  const stamp = String((BigInt(Date.now()) + 11_644_473_600_000n) * 1000n)
  let changed = false
  for (const kind of ['media_stream_mic', 'media_stream_camera']) {
    const site = ((exceptions[kind] ??= {})[`${FACE.replace(/\/$/, '')},*`] ??= {})
    if (site.setting !== 1) {
      site.setting = 1
      site.last_modified = stamp
      changed = true
    }
  }
  if (!changed) return
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(prefs))
}

function openWindow(chrome) {
  grantMedia()
  spawn(
    chrome,
    [
      // ?autostart powers him up without the INITIALISE click; this profile
      // lets audio start without one.
      `--app=${FACE}?autostart`,
      // Its own profile: the window is a separate app (its own taskbar entry),
      // and microphone and camera are allowed here (grantMedia), not in everyday Chrome.
      `--user-data-dir=${WINDOW_PROFILE}`,
      '--autoplay-policy=no-user-gesture-required',
      // Keep listening at full speed while minimised or behind other windows.
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,900',
    ],
    { detached: true, stdio: 'ignore', windowsHide: false },
  ).unref()
}

/**
 * Give the new window JARVIS's own taskbar identity (see taskbar.ps1), so it
 * shows under the JARVIS icon rather than Chrome's and "Pin to taskbar" pins
 * the JARVIS launcher. Waits for the window to appear; a failure only costs
 * the grouping.
 */
function tagWindow() {
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TASKBAR, '-Mode', 'window'],
      {
        env: {
          ...process.env,
          J_LAUNCH: `"${join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'wscript.exe')}" "${join(HOME, 'launch-jarvis.vbs')}"`,
          J_ICON: ICON,
        },
        windowsHide: true,
        stdio: 'ignore',
        timeout: 45_000,
      },
    )
  } catch {
    /* ungrouped is still usable */
  }
}

// --- The brain and the face -----------------------------------------------------

async function waitForServers(isAlive) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (!((await faceUp()) && (await bridgeUp()))) {
    if (!isAlive() || Date.now() > deadline) return false
    await sleep(500)
  }
  return true
}

/** True once both are answering, starting them in the background if needed. */
async function ensureServers() {
  const [face, bridge] = await Promise.all([faceUp(), bridgeUp()])
  if (face && bridge) return true

  // Another launch is already starting them (a double double-click).
  if (existsSync(STARTING) && Date.now() - statSync(STARTING).mtimeMs < STARTUP_TIMEOUT_MS) {
    return waitForServers(() => true)
  }
  if (face !== bridge) {
    alert('Part of JARVIS is already running (port 5173 or 8787 is in use). Close the other copy — or the terminal running `npm start` — and try again.')
    return false
  }

  writeFileSync(STARTING, String(process.pid))
  try {
    const log = openSync(LOG, 'w')
    const servers = spawn(process.execPath, ['scripts/start.mjs'], {
      cwd: ROOT,
      stdio: ['ignore', log, log],
      windowsHide: true,
      detached: true,
    })
    let alive = true
    servers.on('exit', () => (alive = false))
    writeFileSync(PID_FILE, String(servers.pid))
    servers.unref()
    if (await waitForServers(() => alive)) return true
    stopAll()
    alert(`JARVIS could not start. The details are in:\n${LOG}`)
    return false
  } finally {
    rmSync(STARTING, { force: true })
  }
}

/**
 * The icon by the clock. Started through wscript: PowerShell spawned detached
 * from a hidden Node exits at once without running anything, while a hidden
 * window from WScript.Shell.Run is a normal start. It is single-instance, so
 * starting it again is harmless.
 */
function ensureTray() {
  if (!existsSync(ICON)) return // made by desktop:install
  const starter = join(HOME, 'tray.vbs')
  writeFileSync(
    starter,
    `CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${TRAY}""", 0, False\r\n`,
  )
  spawn(
    join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'wscript.exe'),
    [starter],
    {
      env: {
        ...process.env,
        JARVIS_NODE: process.execPath,
        JARVIS_LAUNCHER: LAUNCHER,
        JARVIS_ICON: ICON,
        JARVIS_BRIDGE_PORT: String(BRIDGE_PORT),
        JARVIS_TRAY_HINT: '1',
      },
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  ).unref()
}

/**
 * Everything down. Each process is checked to be JARVIS's own before it is
 * stopped — a stale PID file after a reboot can name anything.
 */
function stopAll() {
  let pid = ''
  try {
    pid = readFileSync(PID_FILE, 'utf8').trim()
  } catch {
    /* none recorded */
  }
  powershell(
    `$procs = Get-CimInstance Win32_Process
     $pid0 = ${/^\d+$/.test(pid) ? pid : 0}
     $starter = $procs | Where-Object { $_.ProcessId -eq $pid0 -and $_.CommandLine -match 'scripts[\\\\/]start\\.mjs' }
     if ($starter) { taskkill /PID $pid0 /T /F | Out-Null }
     $ours = $procs | Where-Object {
       ($_.Name -eq 'node.exe' -and ($_.CommandLine -match 'bridge[\\\\/]server\\.mjs' -or $_.CommandLine -match 'node\\.exe"?\\s+node_modules/vite/bin/vite\\.js' -or $_.CommandLine -match 'scripts[\\\\/]start\\.mjs')) -or
       (($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and $_.CommandLine -like ${psString(`*--user-data-dir=${WINDOW_PROFILE}*`)}) -or
       ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like ${psString(`*${TRAY}*`)})
     }
     foreach ($p in $ours) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }`,
  )
  rmSync(PID_FILE, { force: true })
}

// --- Main -----------------------------------------------------------------------

async function main() {
  if (STOP) {
    stopAll()
    return
  }

  const chrome = findChrome()
  if (!chrome) {
    alert('JARVIS needs Google Chrome or Microsoft Edge. Install one and try again.')
    return
  }

  if (!(await ensureServers())) return
  ensureTray()

  // Already open: bring it back rather than start a second JARVIS listening.
  if (windowAction(9)) return
  openWindow(chrome)
  if (existsSync(ICON)) tagWindow()

  if (LOGIN) {
    for (let i = 0; i < 120 && (await connectedPages()) === 0; i++) await sleep(500)
    await sleep(LOGIN_SHOW_MS)
    windowAction(6)
  }
}

await main()
process.exit(0)
