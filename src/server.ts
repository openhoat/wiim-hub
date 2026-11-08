import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type DeviceEvent, type DevicePatch, type DeviceState, MAX_EVENTS, MAX_SAMPLES, pollDevice } from './device.ts'
import { discoverSsdp } from './discovery.ts'

const port = Number.parseInt(process.env.PORT ?? '8090', 10)
const pollMs = Math.max(1000, Number.parseInt(process.env.POLL_MS ?? '3000', 10))
const discoveryEnabled = (process.env.DISCOVERY ?? '1') !== '0'
const discoveryIntervalMs = 300_000
const publicDir = join(import.meta.dirname, '..', 'public')

const hosts = new Set(
  (process.env.DEVICE_HOSTS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0),
)
const states = new Map<string, DeviceState>()

// Keys are the configured hosts (address or name), so a device keeps its card
// and its history when its DHCP lease moves it to another address.
const emptyState = (host: string): DeviceState => ({
  ip: host,
  name: host,
  model: '',
  firmware: '',
  release: '',
  ssid: '',
  bssid: '',
  group: '',
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
  slaves: 0,
  updatedAt: null,
  online: false,
  lastSeen: null,
  errors: 0,
  samples: [],
  events: [],
})

const pushEvent = (state: DeviceState, kind: DeviceEvent['kind'], from: string, to: string): void => {
  state.events.unshift({ t: Date.now(), kind, from, to })
  state.events.length = Math.min(state.events.length, MAX_EVENTS)
}

const applyPatch = (state: DeviceState, patch: DevicePatch): void => {
  const wasOnline = state.online
  const previousStatus = state.status
  const previousTitle = state.title
  // A failed poll answers nothing: keep the last known identity and playback,
  // only the availability flips. Otherwise a single timeout would erase the
  // device name and make the card useless during an outage.
  state.online = patch.online
  if (patch.online) Object.assign(state, patch)
  const now = Date.now()
  if (patch.online) {
    state.lastSeen = now
    state.updatedAt = now
    state.errors = 0
    if (!wasOnline) pushEvent(state, 'online', '', '')
  } else {
    state.errors += 1
    if (wasOnline) pushEvent(state, 'offline', '', '')
  }
  // The first reading is not a transition: only a real change is worth a line
  // in the log, otherwise every hub restart invents one.
  if (patch.online && previousStatus !== '' && patch.status !== previousStatus) {
    pushEvent(state, 'status', previousStatus, patch.status)
  }
  if (patch.online && patch.title !== previousTitle && patch.title.length > 0) {
    pushEvent(state, 'track', previousTitle, patch.title)
  }
  // Samples carry the patch values, not the retained state: an outage must
  // read as a gap in the series, not as a flat line at the last known RSSI.
  state.samples.push({ t: now, rssi: patch.rssi, volume: patch.volume, status: patch.status, online: patch.online })
  if (state.samples.length > MAX_SAMPLES) state.samples.splice(0, state.samples.length - MAX_SAMPLES)
}

let polling = false
const pollAll = async (): Promise<void> => {
  if (polling) return
  polling = true
  try {
    await Promise.allSettled(
      [...hosts].map(async (host) => {
        const state = states.get(host) ?? emptyState(host)
        states.set(host, state)
        const patch = await pollDevice(host)
        applyPatch(state, patch)
      }),
    )
  } finally {
    polling = false
  }
}

const refreshHosts = async (): Promise<number> => {
  if (!discoveryEnabled) return 0
  const found = await discoverSsdp()
  let added = 0
  for (const ip of found) {
    if (!hosts.has(ip)) {
      hosts.add(ip)
      added += 1
    }
  }
  return added
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

const staticRoutes = new Map<string, { file: string; type: string }>([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/style.css', { file: 'style.css', type: 'text/css; charset=utf-8' }],
  ['/locales/en.json', { file: 'locales/en.json', type: 'application/json; charset=utf-8' }],
  ['/locales/fr.json', { file: 'locales/fr.json', type: 'application/json; charset=utf-8' }],
])

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true, devices: states.size })
    return
  }
  if (url.pathname === '/api/state') {
    sendJson(res, 200, { ts: Date.now(), pollMs, devices: [...states.values()] })
    return
  }
  if (url.pathname === '/api/discover' && req.method === 'POST') {
    const added = await refreshHosts()
    await pollAll()
    sendJson(res, 200, { ts: Date.now(), added, devices: states.size })
    return
  }
  const route = staticRoutes.get(url.pathname)
  if (route) {
    try {
      const body = await readFile(join(publicDir, route.file))
      res.writeHead(200, { 'content-type': route.type, 'cache-control': 'no-store' })
      res.end(body)
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`fichier absent : ${route.file}`)
    }
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('introuvable')
}

createServer((req, res) => {
  void handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('internal error')
  })
}).listen(port, () => {
  console.log(`wiim-hub listening on :${port} (${hosts.size} host(s), poll ${pollMs} ms)`)
})

void pollAll()
void refreshHosts().then(() => pollAll())
setInterval(() => void pollAll(), pollMs)
setInterval(() => void refreshHosts().then(() => pollAll()), discoveryIntervalMs)
