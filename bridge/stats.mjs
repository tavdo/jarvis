import { execFile } from 'node:child_process'
import { statfs } from 'node:fs/promises'
import os from 'node:os'

/**
 * Live machine readings for the interface's diagnostics panels.
 *
 * Numbers only — processor, memory, disk, the graphics card when nvidia-smi
 * is present, and the weather for a city named in JARVIS_WEATHER_CITY. Nothing
 * here is sent to the AI; it is what the screen shows.
 */

let lastCpu = os.cpus()
let cpuAt = Date.now()
let cpuValue = 0

// Several windows poll at once; a sample taken milliseconds after the last one
// would read as idle, so each caller within a second shares the same reading.
function cpuPercent() {
  if (Date.now() - cpuAt < 1_000) return cpuValue
  cpuAt = Date.now()
  const now = os.cpus()
  let idle = 0
  let total = 0
  now.forEach((cpu, i) => {
    const before = lastCpu[i]?.times
    if (!before) return
    for (const key of Object.keys(cpu.times)) total += cpu.times[key] - before[key]
    idle += cpu.times.idle - before.idle
  })
  lastCpu = now
  if (total > 0) cpuValue = Math.round((1 - idle / total) * 100)
  return cpuValue
}

// --- Graphics card ---------------------------------------------------------------

let gpu = { at: 0, value: null }
let gpuMissing = false

function readGpu() {
  if (gpuMissing || Date.now() - gpu.at < 2_500) return gpu.value
  gpu.at = Date.now()
  execFile(
    'nvidia-smi',
    [
      '--query-gpu=name,utilization.gpu,temperature.gpu,power.draw,fan.speed,memory.used,memory.total',
      '--format=csv,noheader,nounits',
    ],
    { timeout: 4_000, windowsHide: true },
    (err, out) => {
      if (err) {
        if (err.code === 'ENOENT') gpuMissing = true
        gpu.value = null
        return
      }
      const [name, util, temp, power, fan, used, total] = out.split('\n')[0].split(',').map((s) => s.trim())
      const n = (s) => (Number.isFinite(Number(s)) ? Number(s) : null)
      gpu.value = {
        name,
        util: n(util),
        temp: n(temp),
        power: n(power),
        fan: n(fan),
        memory: n(used) !== null && n(total) ? Math.round((n(used) / n(total)) * 100) : null,
      }
    },
  )
  return gpu.value
}

// --- Weather ---------------------------------------------------------------------

const WEATHER_TTL_MS = 10 * 60_000
let weather = { at: 0, value: null, pending: false }
let place = null

const WEATHER_WORDS = [
  [0, 'CLEAR'], [3, 'CLOUDY'], [48, 'FOG'], [57, 'DRIZZLE'], [67, 'RAIN'],
  [77, 'SNOW'], [82, 'SHOWERS'], [86, 'SNOW'], [99, 'STORM'],
]
const describe = (code) => WEATHER_WORDS.find(([max]) => code <= max)?.[1] ?? 'UNKNOWN'

async function refreshWeather(city) {
  weather.pending = true
  try {
    if (!place) {
      const geo = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`,
        { signal: AbortSignal.timeout(8_000) },
      ).then((r) => r.json())
      const hit = geo?.results?.[0]
      if (!hit) throw new Error(`no place called ${city}`)
      place = { name: hit.name, lat: hit.latitude, lon: hit.longitude }
    }
    const data = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
        '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
      { signal: AbortSignal.timeout(8_000) },
    ).then((r) => r.json())
    const c = data?.current
    if (c) {
      weather.value = {
        place: place.name,
        lat: place.lat,
        lon: place.lon,
        temp: Math.round(c.temperature_2m),
        humidity: Math.round(c.relative_humidity_2m),
        wind: Math.round(c.wind_speed_10m),
        sky: describe(c.weather_code),
      }
    }
  } catch (err) {
    console.warn(`[jarvis] weather unavailable: ${err?.message ?? err}`)
  } finally {
    weather.at = Date.now()
    weather.pending = false
  }
}

function readWeather(city) {
  if (!city) return null
  if (!weather.pending && Date.now() - weather.at > WEATHER_TTL_MS) void refreshWeather(city)
  return weather.value
}

// ---------------------------------------------------------------------------------

/** @param {{ weatherCity?: string }} options */
export async function readStats({ weatherCity }) {
  let disk = null
  try {
    const s = await statfs(os.homedir())
    disk = Math.round((1 - s.bavail / s.blocks) * 100)
  } catch {
    /* not reported */
  }
  return {
    cpu: cpuPercent(),
    cores: os.cpus().length,
    ram: Math.round((1 - os.freemem() / os.totalmem()) * 100),
    ramTotalGb: Math.round(os.totalmem() / 1024 ** 3),
    disk,
    gpu: readGpu(),
    uptime: Math.round(os.uptime()),
    bridgeUptime: Math.round(process.uptime()),
    weather: readWeather(weatherCity),
  }
}
