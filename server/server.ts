import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { commandFor, parseAction } from './commands.ts'
import {
  artUri,
  cleanTitle,
  type DeviceEvent,
  type DevicePatch,
  type DeviceState,
  fetchAlbumArt,
  fetchCommand,
  MAX_EVENTS,
  MAX_SAMPLES,
  pollDevice,
  readSettings,
  resolveTarget,
} from './device.ts'
import { discoverSsdp } from './discovery.ts'
import { createWriteQueue } from './queue.ts'
import { createEventHub, type EventPatch } from './upnp.ts'

const port = Number.parseInt(process.env.PORT ?? '8090', 10)
const pollMs = Math.max(1000, Number.parseInt(process.env.POLL_MS ?? '3000', 10))
// With a live subscription only the fields nobody events (counters, group,
// inputs, equalizer) still need a poll, so the interval relaxes.
const slowPollMs = Math.max(pollMs, Number.parseInt(process.env.SLOW_POLL_MS ?? '15000', 10))
// The base the players can reach the callback on. Empty means eventing is off:
// a hub behind a bridge network cannot be called back, and guessing an address
// would subscribe devices to a URL that never answers.
const callbackBase = (process.env.UPNP_CALLBACK ?? '').trim()
const upnpPort = Number.parseInt(process.env.UPNP_PORT ?? '8091', 10)
const eventsEnabled = callbackBase !== ''
const upnpRetryMs = 60_000
const discoveryEnabled = (process.env.DISCOVERY ?? '1') !== '0'
const discoveryIntervalMs = 300_000
const distDir = resolve(import.meta.dirname, '..', 'dist')

const hosts = new Set(
  (process.env.DEVICE_HOSTS ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
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
  upnp: { state: 'off', lastEventAt: null, events: 0, misses: 0 },
  samples: [],
  events: [],
})

const pushEvent = (
  state: DeviceState,
  kind: DeviceEvent['kind'],
  from: string,
  to: string
): void => {
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
  state.samples.push({
    t: now,
    rssi: patch.rssi,
    volume: patch.volume,
    status: patch.status,
    online: patch.online,
  })
  if (state.samples.length > MAX_SAMPLES)
    state.samples.splice(0, state.samples.length - MAX_SAMPLES)
}

// A notification is a partial truth: it carries what changed, never the whole
// device. It is applied to the state the polls built, and it goes through the
// same cleaning as a poll so the placeholder "Unknown" cannot come back through
// the event path.
const applyEvent = (ip: string, patch: EventPatch): void => {
  const entry = findEntry(ip)
  if (entry === null) return
  const state = entry.state
  if (!state.online) return
  const previousStatus = state.status
  const previousTitle = state.title
  if (patch.status !== undefined) state.status = patch.status
  if (patch.volume !== undefined) state.volume = patch.volume
  if (patch.mute !== undefined) state.mute = patch.mute
  if (patch.title !== undefined) state.title = cleanTitle(patch.title)
  if (patch.artist !== undefined) state.artist = cleanTitle(patch.artist)
  if (patch.album !== undefined) state.album = cleanTitle(patch.album)
  if (patch.albumArt !== undefined) state.albumArt = artUri(patch.albumArt)
  if (patch.totalMs !== undefined) state.totalMs = patch.totalMs
  state.upnp = hub.status(state.ip)
  if (previousStatus !== '' && state.status !== previousStatus) {
    pushEvent(state, 'status', previousStatus, state.status)
  }
  if (state.title !== previousTitle && state.title.length > 0) {
    pushEvent(state, 'track', previousTitle, state.title)
  }
}

const hub = createEventHub({
  port: upnpPort,
  callbackBase,
  onPatch: applyEvent,
  log: message => console.log(message),
})

const lastSubscribeAttempt = new Map<string, number>()

// One attempt per minute per device: a player that refuses the subscription
// must not be asked on every tick.
const ensureSubscription = (state: DeviceState): void => {
  if (!eventsEnabled || !state.online || hub.isSubscribed(state.ip)) return
  const attempted = lastSubscribeAttempt.get(state.ip) ?? 0
  if (Date.now() - attempted < upnpRetryMs) return
  lastSubscribeAttempt.set(state.ip, Date.now())
  void hub.subscribe(state.ip).then(subscribed => {
    state.upnp = hub.status(state.ip)
    if (!subscribed) lastSubscribeAttempt.set(state.ip, Date.now())
  })
}

// A poll that sees a value the subscription should have announced means the
// notifications are not arriving: two of those and the hub goes back to the
// fast poll instead of trusting a silent channel.
const contradicts = (state: DeviceState, patch: DevicePatch): boolean => {
  if (!state.online || !hub.isSubscribed(state.ip) || !patch.online) return false
  return (
    (patch.status !== '' && patch.status !== state.status) ||
    (patch.volume !== null && patch.volume !== state.volume) ||
    patch.mute !== state.mute ||
    (patch.title !== '' && patch.title !== state.title)
  )
}

let polling = false
const pollAll = async (): Promise<void> => {
  if (polling) return
  polling = true
  try {
    await Promise.allSettled(
      [...hosts].map(async host => {
        const state = states.get(host) ?? emptyState(host)
        states.set(host, state)
        const patch = await pollDevice(host)
        const missed = contradicts(state, patch)
        applyPatch(state, patch)
        if (patch.online && hub.isSubscribed(state.ip)) {
          if (missed) hub.markMiss(state.ip)
          else hub.clearMiss(state.ip)
        }
        state.upnp = hub.status(state.ip)
        ensureSubscription(state)
      })
    )
  } finally {
    polling = false
  }
}

// The device address follows the state entry, so a host that moved to another
// DHCP lease still receives its queued writes on the address the last poll saw.
const writes = createWriteQueue((key, command) => {
  const state = states.get(key)
  return fetchCommand(state?.ip ?? key, command)
})

// A write changes the state the hub renders: read it back quickly instead of
// waiting for the next tick, so the optimistic value is confirmed or dropped
// within a few hundred milliseconds.
let followUp: NodeJS.Timeout | null = null
const pollSoon = (delay: number): void => {
  if (followUp !== null) clearTimeout(followUp)
  followUp = setTimeout(() => {
    followUp = null
    void pollAll()
  }, delay)
}

const refreshHosts = async (): Promise<number> => {
  if (!discoveryEnabled) return 0
  const found = await discoverSsdp()
  let added = 0
  for (const ip of found) {
    // One speaker can be configured under its mDNS name and answered by SSDP
    // under its address: the same machine must not get two cards, and the two
    // spellings must not run two writers against it.
    const known = [...hosts].some(host => host === ip || resolveTarget(host) === ip)
    if (known) continue
    hosts.add(ip)
    added += 1
  }
  return added
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

// A WiiM answers only its own interface: the hub refuses to fetch an address
// it does not already poll, and the cover uri must be the one the device
// reported on its last poll. The route cannot become an open proxy.
const artFor = async (url: URL, res: ServerResponse): Promise<void> => {
  const host = url.searchParams.get('host') ?? ''
  const uri = url.searchParams.get('uri') ?? ''
  const device = states.get(host) ?? [...states.values()].find(state => state.ip === host)
  const known =
    device !== undefined &&
    (device.albumArt === uri || device.presets.some(preset => preset.artwork === uri))
  if (host === '' || uri === '' || device === undefined || !known) {
    console.warn(`wiim-hub: art refused, uri not reported by ${host === '' ? 'any host' : host}`)
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
  res.writeHead(200, {
    'content-type': art.type,
    'cache-control': 'private, max-age=86400, immutable',
  })
  res.end(art.body)
}

const readBody = (req: IncomingMessage, limit = 2048): Promise<string | null> =>
  new Promise(resolve => {
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

// The browser knows a device by the address it last saw, which may be the
// configured name, the resolved address, or both: accept either and write
// through the same queue key so two spellings cannot run two writers.
const findEntry = (host: string): { key: string; state: DeviceState } | null => {
  const direct = states.get(host)
  if (direct !== undefined) return { key: host, state: direct }
  for (const [key, state] of states) {
    if (state.ip === host) return { key, state }
  }
  return null
}

const commandRoute = async (url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> => {
  // A JSON content type cannot be produced by an HTML form, so a cross-site
  // form post cannot reach a device even when the ingress cookie is loose.
  const type = req.headers['content-type'] ?? ''
  if (!type.toLowerCase().includes('application/json')) {
    sendJson(res, 415, { error: 'content-type must be application/json' })
    return
  }
  const host = url.searchParams.get('host') ?? ''
  const entry = host === '' ? null : findEntry(host)
  if (entry === null) {
    sendJson(res, 404, { error: 'unknown device' })
    return
  }
  // Writing to a device that just stopped answering would queue a command for
  // a machine nobody can reach: refuse, and let the user retry when it is back.
  if (!entry.state.online) {
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
  const command = commandFor(parsed.action, entry.state)
  if ('error' in command) {
    sendJson(res, 422, command)
    return
  }
  const outcome = await writes.enqueue(entry.key, command.command, command.family)
  pollSoon(400)
  sendJson(res, 200, outcome)
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
    // A stable order across polls and machines: a card must not jump when a
    // second speaker answers or renames itself, and a reachable speaker comes
    // before a silent one.
    const devices = [...states.values()].sort(
      (left, right) =>
        Number(right.online) - Number(left.online) ||
        left.name.localeCompare(right.name) ||
        left.ip.localeCompare(right.ip)
    )
    sendJson(res, 200, { ts: Date.now(), pollMs, devices })
    return
  }
  if (url.pathname === '/api/art') {
    await artFor(url, res)
    return
  }
  // Settings are read when the sheet opens, not on every poll: the answer is a
  // set of four writes nobody watches between visits.
  if (url.pathname === '/api/settings') {
    const host = url.searchParams.get('host') ?? ''
    const entry = host === '' ? null : findEntry(host)
    if (entry === null) {
      sendJson(res, 404, { error: 'unknown device' })
      return
    }
    if (!entry.state.online) {
      sendJson(res, 409, { error: 'device offline' })
      return
    }
    const settings = await readSettings(entry.state.ip)
    if (settings === null) {
      sendJson(res, 502, { error: 'device did not answer' })
      return
    }
    sendJson(res, 200, settings)
    return
  }
  if (url.pathname === '/api/command' && req.method === 'POST') {
    await commandRoute(url, req, res)
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

// The interval follows the subscriptions: while every device pushes, only the
// fields nobody events need polling, so the loop relaxes instead of stopping.
const allSubscribed = (): boolean => {
  const list = [...states.values()].filter(state => state.online)
  return eventsEnabled && list.length > 0 && list.every(state => hub.isSubscribed(state.ip))
}

let pollTimer: NodeJS.Timeout | null = null
const scheduleNextPoll = (): void => {
  if (pollTimer !== null) clearTimeout(pollTimer)
  const delay = allSubscribed() ? slowPollMs : pollMs
  pollTimer = setTimeout(() => {
    void pollAll().finally(scheduleNextPoll)
  }, delay)
}

const main = async (): Promise<void> => {
  if (eventsEnabled) await hub.start().catch(() => undefined)
  else console.log('wiim-hub: UPnP events off (UPNP_CALLBACK is empty)')
  await pollAll()
  scheduleNextPoll()
  void refreshHosts().then(() => pollAll())
  setInterval(() => void refreshHosts().then(() => pollAll()), discoveryIntervalMs)
}

const shutdown = (): void => {
  void hub.close().finally(() => process.exit(0))
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)

void main()
