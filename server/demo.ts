// A demo hub: the real interface over simulated speakers, so the project can
// be tried and screenshotted without owning a WiiM.
//
// Every state below is typed as `DeviceState`, the shape the real server
// renders: a change in the real polling code breaks this file at compile time
// instead of letting the demo drift into a parallel universe. Writes go through
// the same `parseAction` and `commandFor` the hub uses, so the volume ceiling and
// the available inputs and outputs are enforced here too; only the last step
// differs, the command mutates memory instead of reaching a device.
//
//   npm run demo            # http://localhost:8090
//   PORT=8091 npm run demo
//
// The addresses are documentation addresses (RFC 5737 TEST-NET-1), the Wi-Fi
// identifiers are invented, and the covers are generated: nothing here is a
// copy of a real fleet.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { commandFor, parseAction, type Action } from './commands.ts'
import { MAX_SAMPLES, type DeviceSettings, type DeviceState, type Sample } from './device.ts'

const port = Number.parseInt(process.env.PORT ?? '8090', 10)
const tickMs = 3000
const distDir = resolve(import.meta.dirname, '..', 'dist')

// A cover is drawn from its own uri, so the same track always gets the same
// image: a screenshot can be retaken and a test can look for a stable layout.
const fnv = (value: string): number => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

const coverSvg = (uri: string): string => {
  const hash = fnv(uri)
  const base = hash % 360
  const accent = (base + 55 + ((hash >>> 8) % 90)) % 360
  const glowX = 25 + ((hash >>> 5) % 55)
  const glowY = 20 + ((hash >>> 13) % 50)
  const radius = 140 + ((hash >>> 17) % 140)
  const ring = (offset: number, opacity: number): string =>
    `<circle cx="256" cy="256" r="${radius + offset}" stroke-width="1.5" stroke-opacity="${opacity}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${base} 36% 26%)"/>
      <stop offset="1" stop-color="hsl(${accent} 30% 10%)"/>
    </linearGradient>
    <radialGradient id="glow" cx="${glowX}%" cy="${glowY}%" r="70%">
      <stop offset="0" stop-color="hsl(${accent} 78% 62%)" stop-opacity="0.62"/>
      <stop offset="1" stop-color="hsl(${accent} 78% 62%)" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#base)"/>
  <rect width="512" height="512" fill="url(#glow)"/>
  <g fill="none" stroke="hsl(${accent} 86% 82%)">
    ${ring(0, 0.22)}
    ${ring(38, 0.14)}
    ${ring(92, 0.08)}
  </g>
  <path d="M0 404 L512 300 L512 512 L0 512 Z" fill="hsl(${base} 40% 8%)" fill-opacity="0.55"/>
</svg>
`
}

const emptyState = (ip: string): DeviceState => ({
  ip,
  name: ip,
  model: '',
  firmware: '',
  release: '',
  ssid: '',
  bssid: '',
  group: { role: 'none', name: '', members: [], saved: false },
  rssi: null,
  volume: null,
  status: '',
  title: '',
  artist: '',
  album: '',
  albumArt: '',
  curposMs: null,
  totalMs: null,
  source: '',
  mode: '',
  input: '',
  maxVolume: null,
  mute: false,
  sleepSeconds: null,
  inputs: [],
  inputLabels: {},
  outputs: [],
  outputHardware: null,
  presets: [],
  eq: { enabled: false, name: '', source: '', bands: [], presets: [], roomFit: false },
  quality: { sampleRate: null, bitDepth: null, bitRate: null },
  updatedAt: null,
  online: false,
  lastSeen: null,
  errors: 0,
  samples: [],
  events: [],
})

// The ten bands, in the order the device reports them: a demo curve that
// respects the same names keeps the sound card honest.
const eqBands = ['band31hz', 'band63hz', 'band125hz', 'band250hz', 'band500hz', 'band1khz', 'band2khz', 'band4khz', 'band8khz', 'band16khz']
const eqValues = [5, 3.5, 1, -0.5, -1.5, -1, 0, 1.5, 3, 2]

// The factory curves the WiiM app lists, `Game` included: the demo offers the
// same menu the real equalizer does.
const eqPresets = [
  'Flat',
  'Acoustic',
  'Bass Booster',
  'Bass Reducer',
  'Classical',
  'Dance',
  'Deep',
  'Electronic',
  'Folk',
  'Game',
  'Hip-Hop',
  'Jazz',
  'Latin',
  'Loudness',
  'Lounge',
  'Piano',
  'Pop',
  'R&B',
  'Rock',
  'Small Speakers',
  'Spoken Word',
  'Treble Booster',
  'Treble Reducer',
  'Vocal Booster',
]

type Track = {
  title: string
  artist: string
  album: string
  art: string
  durationMs: number
  quality: DeviceState['quality']
}

const livingRoomTracks: Track[] = [
  {
    title: 'Late Ferry',
    artist: 'The Harbour Lights',
    album: 'Night Crossings',
    art: 'demo://cover/night-crossings',
    durationMs: 254_000,
    quality: { sampleRate: 96_000, bitDepth: 24, bitRate: 2304 },
  },
  {
    title: 'Paper Lanterns',
    artist: 'Mira Vale',
    album: 'Slow Signals',
    art: 'demo://cover/slow-signals',
    durationMs: 213_000,
    quality: { sampleRate: 48_000, bitDepth: 24, bitRate: 1536 },
  },
  {
    title: 'Northbound',
    artist: 'Kestrel Bay',
    album: 'Field Notes',
    art: 'demo://cover/field-notes',
    durationMs: 301_000,
    quality: { sampleRate: 44_100, bitDepth: 16, bitRate: 1411 },
  },
]

// A seeded walk rather than Math.random: two runs of the demo draw the same
// signal history, which is what makes a screenshot or a test comparable.
const makeWalk = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const history = (seed: number, base: number, onlineFrom: number): Sample[] => {
  const walk = makeWalk(seed)
  const now = Date.now()
  const samples: Sample[] = []
  for (let index = 0; index < MAX_SAMPLES; index += 1) {
    const online = index >= onlineFrom
    const drift = Math.sin(index / 19) * 3 + (walk() - 0.5) * 2
    samples.push({
      t: now - (MAX_SAMPLES - index) * tickMs,
      rssi: online ? Math.round(base + drift) : null,
      volume: online ? 44 : null,
      status: online ? 'play' : '',
      online,
    })
  }
  return samples
}

const livingRoom = (): DeviceState => {
  const state = emptyState('192.0.2.21')
  const track = livingRoomTracks[0]
  const now = Date.now()
  return {
    ...state,
    name: 'Living Room',
    model: 'WiiM Pro',
    firmware: 'Linkplay.4.8.833748',
    release: '20261027',
    ssid: 'Demo Wi-Fi',
    bssid: '02:00:00:00:00:21',
    group: {
      role: 'master',
      name: 'Apartment',
      members: [{ name: 'Bedroom', ip: '', uuid: 'a1b27c4d-e6f0-498b-93d5-e0c7a4f28b61' }],
      saved: false,
    },
    rssi: -52,
    volume: 44,
    status: 'play',
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArt: track.art,
    curposMs: 68_000,
    totalMs: track.durationMs,
    source: 'wifi',
    mode: '31',
    input: 'wifi',
    maxVolume: 100,
    mute: false,
    sleepSeconds: null,
    inputs: ['wifi', 'bluetooth', 'line-in', 'optical', 'udisk'],
    inputLabels: { wifi: 'Wi-Fi', bluetooth: 'Bluetooth', 'line-in': 'Line in', optical: 'Optical', udisk: 'USB' },
    outputs: [
      { hardware: 1, name: 'Optical' },
      { hardware: 2, name: 'Line out' },
      { hardware: 3, name: 'Coaxial' },
    ],
    outputHardware: 1,
    presets: [
      { number: 1, name: 'Morning Radio', artwork: 'demo://cover/morning-radio' },
      { number: 3, name: 'Sunday Jazz', artwork: 'demo://cover/sunday-jazz' },
    ],
    eq: {
      enabled: true,
      name: '',
      source: 'wifi',
      bands: eqBands.map((name, index) => ({ name, value: eqValues[index] })),
      presets: eqPresets,
      roomFit: true,
    },
    quality: track.quality,
    updatedAt: now,
    online: true,
    lastSeen: now,
    errors: 0,
    samples: history(7, -52, 0),
    events: [
      { t: now - 240_000, kind: 'track', from: 'Paper Lanterns', to: 'Late Ferry' },
      { t: now - 900_000, kind: 'status', from: 'pause', to: 'play' },
      { t: now - 3_600_000, kind: 'online', from: '', to: '' },
    ],
  }
}

const bedroom = (): DeviceState => {
  const state = emptyState('192.0.2.22')
  const now = Date.now()
  return {
    ...state,
    name: 'Bedroom',
    model: 'WiiM Mini',
    firmware: 'Linkplay.4.8.833748',
    release: '20261027',
    ssid: 'Demo Wi-Fi',
    bssid: '02:00:00:00:00:22',
    group: { role: 'none', name: 'Apartment', members: [], saved: true },
    rssi: -68,
    volume: 30,
    status: 'pause',
    title: 'Paper Lanterns',
    artist: 'Mira Vale',
    album: 'Slow Signals',
    albumArt: 'demo://cover/slow-signals',
    curposMs: 42_000,
    totalMs: 213_000,
    source: 'wifi',
    mode: '31',
    input: 'wifi',
    maxVolume: 90,
    mute: false,
    sleepSeconds: null,
    inputs: ['wifi', 'bluetooth', 'line-in'],
    inputLabels: { wifi: 'Wi-Fi', bluetooth: 'Bluetooth', 'line-in': 'Line in' },
    outputs: [{ hardware: 2, name: 'Line out' }],
    outputHardware: 2,
    presets: [],
    eq: {
      enabled: false,
      name: 'Flat',
      source: 'wifi',
      bands: eqBands.map((name) => ({ name, value: 0 })),
      presets: eqPresets,
      roomFit: false,
    },
    quality: { sampleRate: 48_000, bitDepth: 24, bitRate: 1536 },
    updatedAt: now - 480_000,
    online: false,
    lastSeen: now - 480_000,
    errors: 3,
    samples: history(11, -68, MAX_SAMPLES - 30),
    events: [
      { t: now - 481_000, kind: 'offline', from: '', to: '' },
      { t: now - 1_500_000, kind: 'track', from: 'Northbound', to: 'Paper Lanterns' },
    ],
  }
}

const states = new Map<string, DeviceState>([
  ['192.0.2.21', livingRoom()],
  ['192.0.2.22', bedroom()],
])

const settings = new Map<string, DeviceSettings>([
  [
    '192.0.2.21',
    { name: 'Living Room', ledOn: true, buttonsOn: true, balance: -0.2, maxVolume: 100, fade: true },
  ],
  ['192.0.2.22', { name: 'Bedroom', ledOn: true, buttonsOn: false, balance: 0, maxVolume: 90, fade: false }],
])

const trackIndex = new Map<string, number>([['192.0.2.21', 0]])

const applyTrack = (state: DeviceState, track: Track): void => {
  state.title = track.title
  state.artist = track.artist
  state.album = track.album
  state.albumArt = track.art
  state.totalMs = track.durationMs
  state.curposMs = 0
  state.quality = track.quality
  state.updatedAt = Date.now()
}

const step = (state: DeviceState, direction: number): void => {
  const tracks = livingRoomTracks
  const current = trackIndex.get(state.ip) ?? 0
  const next = (current + direction + tracks.length) % tracks.length
  trackIndex.set(state.ip, next)
  applyTrack(state, tracks[next])
}

// The write surface: the action has already been validated against the state by
// `commandFor`, so this only has to make the simulated speaker behave like the
// measured one (a track change resets the position, a stop keeps the track).
const mutate = (state: DeviceState, action: Action): void => {
  const deviceSettings = settings.get(state.ip)
  switch (action.action) {
    case 'play':
      state.status = 'play'
      break
    case 'pause':
      state.status = 'pause'
      break
    case 'toggle':
      state.status = state.status === 'play' ? 'pause' : 'play'
      break
    case 'stop':
      state.status = 'stop'
      break
    case 'next':
      step(state, 1)
      state.status = 'play'
      break
    case 'prev':
      step(state, -1)
      state.status = 'play'
      break
    case 'seek':
      state.curposMs = action.seconds * 1000
      break
    case 'volume':
      state.volume = action.level
      state.mute = false
      break
    case 'mute':
      state.mute = action.muted
      break
    case 'source':
      state.input = action.input
      state.source = action.input
      break
    case 'preset': {
      const preset = state.presets.find((entry) => entry.number === action.slot)
      if (preset !== undefined) {
        state.title = preset.name
        state.artist = 'Radio'
        state.album = ''
        state.albumArt = preset.artwork
        state.curposMs = 0
        state.totalMs = 0
      }
      state.status = 'play'
      break
    }
    case 'sleep':
      state.sleepSeconds = action.seconds === 0 ? null : action.seconds
      break
    case 'output':
      state.outputHardware = action.hardware
      break
    case 'eq':
      state.eq.enabled = action.enabled
      break
    case 'eqPreset':
      state.eq.name = action.name
      state.eq.enabled = true
      break
    case 'eqBand': {
      // The firmware drops the factory name as soon as one band moves: the
      // curve is custom from then on.
      const band = state.eq.bands.find((entry) => entry.name === action.band)
      if (band !== undefined) band.value = Math.round(action.value * 10) / 10
      state.eq.name = ''
      break
    }
    case 'rename':
      state.name = action.name
      if (deviceSettings !== undefined) deviceSettings.name = action.name
      break
    case 'led':
      if (deviceSettings !== undefined) deviceSettings.ledOn = action.on
      break
    case 'buttons':
      if (deviceSettings !== undefined) deviceSettings.buttonsOn = action.on
      break
    case 'balance':
      if (deviceSettings !== undefined) deviceSettings.balance = Math.round(action.value * 10) / 10
      break
    case 'maxVolume':
      state.maxVolume = action.level
      if (deviceSettings !== undefined) deviceSettings.maxVolume = action.level
      break
    case 'fade':
      if (deviceSettings !== undefined) deviceSettings.fade = action.on
      break
    case 'url':
      // Measured on the Pro: the player switches to its push mode and reports
      // the address as the title.
      state.title = action.url
      state.artist = ''
      state.album = ''
      state.albumArt = ''
      state.source = 'wifi'
      state.status = 'play'
      state.curposMs = 0
      state.totalMs = 0
      break
  }
  state.updatedAt = Date.now()
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
}

const serveFile = async (pathname: string, res: ServerResponse): Promise<boolean> => {
  const root = resolve(distDir)
  const target = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
  if (target !== root && !target.startsWith(`${root}${sep}`)) return false
  try {
    const body = await readFile(target)
    const extension = extname(target)
    const immutable = pathname.startsWith('/assets/')
    res.writeHead(200, {
      'content-type': contentTypes[extension] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    res.end(body)
    return true
  } catch {
    return false
  }
}

const readBody = (req: IncomingMessage, limit = 2048): Promise<string | null> =>
  new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        req.destroy()
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })

const findState = (host: string): DeviceState | null => {
  const direct = states.get(host)
  if (direct !== undefined) return direct
  for (const state of states.values()) {
    if (state.ip === host || state.name.toLowerCase() === host.toLowerCase()) return state
  }
  return null
}

// The art route keeps the hub's rule: only a cover the simulated device
// reported is served, so the route cannot become a proxy even in a demo.
const artFor = (url: URL, res: ServerResponse): void => {
  const host = url.searchParams.get('host') ?? ''
  const uri = url.searchParams.get('uri') ?? ''
  const state = host === '' ? null : findState(host)
  const known =
    state !== null && (state.albumArt === uri || state.presets.some((preset) => preset.artwork === uri))
  if (state === null || uri === '' || !known) {
    sendJson(res, 400, { error: 'unknown artwork' })
    return
  }
  res.writeHead(200, {
    'content-type': 'image/svg+xml',
    'cache-control': 'private, max-age=86400, immutable',
  })
  res.end(coverSvg(uri))
}

const commandRoute = async (url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const type = req.headers['content-type'] ?? ''
  if (!type.toLowerCase().includes('application/json')) {
    sendJson(res, 415, { error: 'content-type must be application/json' })
    return
  }
  const state = findState(url.searchParams.get('host') ?? '')
  if (state === null) {
    sendJson(res, 404, { error: 'unknown device' })
    return
  }
  if (!state.online) {
    sendJson(res, 409, { error: 'device offline' })
    return
  }
  const raw = await readBody(req)
  if (raw === null) {
    sendJson(res, 413, { error: 'body too large' })
    return
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    sendJson(res, 400, { error: 'invalid json' })
    return
  }
  const parsed = parseAction(body)
  if ('error' in parsed) {
    sendJson(res, 400, parsed)
    return
  }
  const command = commandFor(parsed.action, state)
  if ('error' in command) {
    sendJson(res, 422, command)
    return
  }
  mutate(state, parsed.action)
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ ok: true, unsupported: false, command: command.command, body: 'OK' }))
}

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true, devices: states.size, demo: true })
    return
  }
  if (url.pathname === '/api/state') {
    // Same ordering as the hub: reachable first, then by name.
    const devices = [...states.values()].sort(
      (left, right) =>
        Number(right.online) - Number(left.online) ||
        left.name.localeCompare(right.name) ||
        left.ip.localeCompare(right.ip),
    )
    sendJson(res, 200, { ts: Date.now(), pollMs: tickMs, devices })
    return
  }
  if (url.pathname === '/api/art') {
    artFor(url, res)
    return
  }
  if (url.pathname === '/api/settings') {
    const state = findState(url.searchParams.get('host') ?? '')
    if (state === null) {
      sendJson(res, 404, { error: 'unknown device' })
      return
    }
    if (!state.online) {
      sendJson(res, 409, { error: 'device offline' })
      return
    }
    const entry = settings.get(state.ip)
    if (entry === undefined) {
      sendJson(res, 502, { error: 'device did not answer' })
      return
    }
    sendJson(res, 200, entry)
    return
  }
  if (url.pathname === '/api/command' && req.method === 'POST') {
    await commandRoute(url, req, res)
    return
  }
  if (url.pathname === '/api/discover' && req.method === 'POST') {
    // Discovery finds nothing new: the demo fleet is fixed.
    sendJson(res, 200, { ts: Date.now(), added: 0, devices: states.size })
    return
  }
  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  const served = await serveFile(url.pathname, res)
  if (served) return
  if (extname(url.pathname) === '') {
    const shell = await serveFile('/index.html', res)
    if (shell) return
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
}

createServer((req, res) => {
  void handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('internal error')
  })
}).listen(port, () => {
  console.log(`wiim-hub demo listening on :${port} (${states.size} simulated speakers, no device needed)`)
})

// A live hub reads its device every few seconds: the demo advances the track
// and appends a sample on the same beat, so the progress bar and the sparkline
// move instead of showing a frozen capture.
const drift = makeWalk(23)
setInterval(() => {
  const now = Date.now()
  for (const state of states.values()) {
    if (!state.online) continue
    if (state.status === 'play' && state.curposMs !== null && state.totalMs !== null && state.totalMs > 0) {
      state.curposMs = Math.min(state.totalMs, state.curposMs + tickMs)
      if (state.curposMs >= state.totalMs) state.status = 'stop'
    }
    const rssi = Math.round(-52 + (drift() - 0.5) * 4)
    state.rssi = rssi
    state.updatedAt = now
    state.lastSeen = now
    state.samples.push({ t: now, rssi, volume: state.volume, status: state.status, online: true })
    if (state.samples.length > MAX_SAMPLES) {
      state.samples.splice(0, state.samples.length - MAX_SAMPLES)
    }
  }
}, tickMs)
