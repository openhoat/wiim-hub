import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import {
  type DeviceEvent,
  type DevicePatch,
  type DeviceState,
  fetchAlbumArt,
  MAX_EVENTS,
  MAX_SAMPLES,
  pollDevice,
} from './device.ts'
import { discoverSsdp } from './discovery.ts'

const port = Number.parseInt(process.env.PORT ?? '8090', 10)
const pollMs = Math.max(1000, Number.parseInt(process.env.POLL_MS ?? '3000', 10))
const discoveryEnabled = (process.env.DISCOVERY ?? '1') !== '0'
const discoveryIntervalMs = 300_000
const distDir = resolve(import.meta.dirname, '..', 'dist')

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

// A WiiM answers only its own interface: the hub refuses to fetch an address
// it does not already poll, and the cover uri must be the one the device
// reported on its last poll. The route cannot become an open proxy.
const artFor = async (url: URL, res: ServerResponse): Promise<void> => {
  const host = url.searchParams.get('host') ?? ''
  const uri = url.searchParams.get('uri') ?? ''
  const device = states.get(host) ?? [...states.values()].find((state) => state.ip === host)
  if (host === '' || uri === '' || device === undefined || device.albumArt !== uri) {
    sendJson(res, 400, { error: 'unknown artwork' })
    return
  }
  const art = await fetchAlbumArt(host, uri)
  if (art === null) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end('no art')
    return
  }
  // The query carries the track, so a cover is immutable for its URL: the
  // browser stops asking on every poll while a track plays.
  res.writeHead(200, { 'content-type': art.type, 'cache-control': 'private, max-age=86400, immutable' })
  res.end(art.body)
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
  if (url.pathname === '/api/art') {
    await artFor(url, res)
    return
  }
  if (url.pathname === '/api/discover' && req.method === 'POST') {
    const added = await refreshHosts()
    await pollAll()
    sendJson(res, 200, { ts: Date.now(), added, devices: states.size })
    return
  }
  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  // A client-side route has no extension: hand it the shell and let the app
  // decide. An unknown asset stays a 404 instead of silently returning HTML.
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
  console.log(`wiim-hub listening on :${port} (${hosts.size} host(s), poll ${pollMs} ms)`)
})

void pollAll()
void refreshHosts().then(() => pollAll())
setInterval(() => void pollAll(), pollMs)
setInterval(() => void refreshHosts().then(() => pollAll()), discoveryIntervalMs)
