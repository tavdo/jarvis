/**
 * Puts a JARVIS icon on the desktop and in the Start menu (Windows).
 *
 *   npm run desktop:install
 *
 * The shortcut runs scripts/desktop.mjs through a tiny VBScript, which is the
 * standard way to start a console program on Windows without a console window
 * flashing up. The icon — an arc reactor — is drawn here rather than shipped
 * as a binary. Everything generated lives in ~/.jarvis; run it again after
 * moving the JARVIS folder.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import process from 'node:process'

if (process.platform !== 'win32') {
  console.log('The desktop shortcut is for Windows. Elsewhere, run `npm start` and open the URL it prints.')
  process.exit(0)
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOME = join(homedir(), '.jarvis')
mkdirSync(HOME, { recursive: true })

// --- The icon ---------------------------------------------------------------

const SIZE = 256

/** Distance from (px, py) to the segment (ax, ay)-(bx, by). */
function segment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function drawReactor() {
  const c = SIZE / 2
  const glow = (d, width) => Math.exp(-((d / width) ** 2))
  const tri = [0, 1, 2].map((k) => {
    const a = Math.PI / 2 + (k * 2 * Math.PI) / 3
    return [c + 62 * Math.cos(a), c + 62 * Math.sin(a)]
  })
  const px = Buffer.alloc(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c)
      const angle = Math.atan2(y + 0.5 - c, x + 0.5 - c)
      // Disc edge, anti-aliased.
      const alpha = Math.max(0, Math.min(1, 124 - r))
      if (!alpha) continue

      let light = 0
      light += glow(r - 112, 4) // outer ring
      const gap = Math.abs(((angle * 12) / (2 * Math.PI) + 12) % 1 - 0.5) > 0.42 ? 0 : 1
      light += glow(r - 90, 5) * gap * 0.85 // segmented ring
      const edge = Math.min(
        segment(x, y, ...tri[0], ...tri[1]),
        segment(x, y, ...tri[1], ...tri[2]),
        segment(x, y, ...tri[2], ...tri[0]),
      )
      light += glow(edge, 4.5) * 1.1 // triangle
      light += glow(r, 22) * 1.4 // core
      light += glow(r - 112, 14) * 0.25 + glow(edge, 14) * 0.25 // haze

      const core = glow(r, 12)
      const i = (y * SIZE + x) * 4
      // Deep navy base, cyan light, white-hot centre.
      px[i] = Math.min(255, 6 + light * 70 + core * 200)
      px[i + 1] = Math.min(255, 18 + light * 215 + core * 40)
      px[i + 2] = Math.min(255, 30 + light * 255)
      px[i + 3] = Math.round(alpha * 255)
    }
  }
  return px
}

function png(rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(SIZE, 0)
  header.writeUInt32BE(SIZE, 4)
  header.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA
  const rows = Buffer.alloc((SIZE * 4 + 1) * SIZE)
  for (let y = 0; y < SIZE; y++) rgba.copy(rows, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A one-image .ico holding a PNG, which Windows has read since Vista. */
function ico(image) {
  const head = Buffer.alloc(22)
  head.writeUInt16LE(1, 2) // type: icon
  head.writeUInt16LE(1, 4) // one image
  // width and height 0 mean 256
  head.writeUInt16LE(1, 10) // colour planes
  head.writeUInt16LE(32, 12) // bits per pixel
  head.writeUInt32LE(image.length, 14)
  head.writeUInt32LE(22, 18)
  return Buffer.concat([head, image])
}

const iconPath = join(HOME, 'jarvis.ico')
const picture = png(drawReactor())
writeFileSync(iconPath, ico(picture))
writeFileSync(join(HOME, 'jarvis-icon.png'), picture)

// --- The hidden starter and the shortcuts --------------------------------------

const vbsQuote = (s) => `""${s}""`
/** A .vbs that runs the launcher with no console window. */
function starter(name, flag) {
  const path = join(HOME, name)
  const command = `${vbsQuote(process.execPath)} ${vbsQuote(join(ROOT, 'scripts', 'desktop.mjs'))}${flag ? ` ${flag}` : ''}`
  writeFileSync(
    path,
    [
      "' Runs the JARVIS launcher without a console window. Made by npm run desktop:install.",
      `CreateObject("WScript.Shell").Run "${command}", 0, False`,
      '',
    ].join('\r\n'),
  )
  return path
}

const openVbs = starter('launch-jarvis.vbs')
const loginVbs = starter('launch-jarvis-login.vbs', '--login')
const stopVbs = starter('stop-jarvis.vbs', '--stop')
const autostart = !process.argv.includes('--no-autostart')

const ps = (s) => `'${String(s).replace(/'/g, "''")}'`
const made = execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `$shell = New-Object -ComObject WScript.Shell
     function Link($dir, $name, $vbs, $description) {
       $path = Join-Path $dir $name
       $link = $shell.CreateShortcut($path)
       $link.TargetPath = (Join-Path $env:WINDIR 'System32\\wscript.exe')
       $link.Arguments = '"' + $vbs + '"'
       $link.WorkingDirectory = ${ps(ROOT)}
       $link.IconLocation = ${ps(iconPath)} + ',0'
       $link.Description = $description
       $link.Save()
       $path
     }
     $programs = [Environment]::GetFolderPath('Programs')
     Link ([Environment]::GetFolderPath('Desktop')) 'JARVIS.lnk' ${ps(openVbs)} 'J.A.R.V.I.S. — your voice assistant'
     Link $programs 'JARVIS.lnk' ${ps(openVbs)} 'J.A.R.V.I.S. — your voice assistant'
     Link $programs 'Stop JARVIS.lnk' ${ps(stopVbs)} 'Stop J.A.R.V.I.S. completely'
     $startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'JARVIS.lnk'
     if (${autostart ? '$true' : '$false'}) {
       Link ([Environment]::GetFolderPath('Startup')) 'JARVIS.lnk' ${ps(loginVbs)} 'Starts J.A.R.V.I.S. when you sign in'
     } elseif (Test-Path $startup) {
       Remove-Item $startup
     }`,
  ],
  { encoding: 'utf8', windowsHide: true },
)

const links = made.trim().split(/\r?\n/)

// The open-JARVIS shortcuts share the window's taskbar identity (taskbar.ps1),
// so a pinned JARVIS and the running window are one taskbar button.
for (const link of links.filter((l) => /JARVIS\.lnk$/i.test(l) && !/Startup/i.test(l) && !/Stop JARVIS/i.test(l))) {
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'taskbar.ps1'), '-Mode', 'shortcut', '-Path', link],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (err) {
    console.warn(`Could not give ${link} the JARVIS taskbar identity: ${String(err.stderr || err.message).trim()}`)
  }
}

console.log('\nJARVIS shortcuts created:')
for (const line of links) console.log(`  ${line}`)
console.log('\nDouble-click JARVIS on the desktop. The first time, allow the microphone in its window.')
console.log('To keep him on the taskbar: while he is open, right-click his taskbar icon and choose "Pin to taskbar".')
console.log(
  autostart
    ? 'JARVIS also starts when you sign in to Windows (npm run desktop:install -- --no-autostart turns that off).'
    : 'JARVIS will not start with Windows.',
)
console.log('Closing the window leaves him running by the clock; right-click the tray icon, or "Stop JARVIS", to quit.')
console.log('Startup output is logged to ~/.jarvis/jarvis.log.\n')
