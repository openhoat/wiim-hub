import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { commandFor, parseAction } from './commands.ts'
import { fetchAlbumArt } from './device/art.ts'
import { readDiagnostics } from './device/diagnostics.ts'
import { type DevicePatch, type DeviceState, pollDevice } from './device/index.ts'
import { artUri, cleanTitle } from './device/payload.ts'
import { resolveTarget } from './device/resolve.ts'
import { readSettings } from './device/settings.ts'
import { type DeviceEvent, MAX_EVENTS, MAX_SAMPLES } from './device/status.ts'
import { fetchCommand } from './device/transport.ts'
import { discoverSsdp } from './discovery.ts'
import { buildReport, findingsFor } from './findings.ts'
import { guidesFor } from './guides.ts'
import {
  type HostEntry,
  hostEntries,
  normalizeHost,
  readHostsFile,
  writeHostsFile,
} from './hosts.ts'
import { readInventory, resolutionFor } from './inventory.ts'
import { notifierFromEnv } from './notify.ts'
import { createWriteQueue } from './queue.ts'
import { readServices } from './services.ts'
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
// The diagnostic counters move over hours, so they are read on their own slow
// cadence instead of on every poll.
const diagnosticsMs = 60_000
// The image carries no package.json at runtime: the version comes from the
// environment, and the compose file knows it.
const hubVersion = (process.env.HUB_VERSION ?? 'dev').trim()
const discoveryEnabled = (process.env.DISCOVERY ?? '1') !== '0'
// Null while no channel has an address: a hub that has nowhere to send says so
// once at start, and the poll loop pays a null test per device.
const notifier = notifierFromEnv()
const discoveryIntervalMs = 300_000
const distDir = resolve(import.meta.dirname, '..', 'dist', 'app')

const envHosts = new Set(
  (process.env.DEVICE_HOSTS ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
)
// The hosts the page saved, and the ones discovery found: only the first list
// is written to disk, the two others have an owner already.
const savedHosts = new Set<string>()
// The polled set is the union of the three, so a card exists for a host whatever
// brought it in, and removing one is removing it from here as well.
const hosts = new Set(envHosts)
// The saved list is a JSON file on a volume: the hub owns it, but a hand edit is
// expected, so it is read at start and written whole on every change.
const hostsFile =
  (process.env.HOSTS_FILE ?? '').trim() || resolve(import.meta.dirname, '..', 'data', 'hosts.json')
const states = new Map<string, DeviceState>()
// Read before the server listens, so the startup line and the first poll already
// count what the page kept. Top-level await is available here: this module is
// the process entry point.
for (const host of await readHostsFile(hostsFile)) {
  if (envHosts.has(host)) continue
  savedHosts.add(host)
  hosts.add(host)
}

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
  wmrmVersion: '',
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
  link: { snr: null, noise: null, freqMhz: null, rateMbps: null },
  diagnostics: null,
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

// One probe set in flight per device at most: the counters are cheap but three
// commands per tick would still be wasted when a device answers slowly.
const probing = new Set<string>()
const refreshDiagnostics = (state: DeviceState): void => {
  if (!state.online || probing.has(state.ip)) return
  const at = state.diagnostics?.at ?? 0
  if (Date.now() - at < diagnosticsMs) return
  probing.add(state.ip)
  void readDiagnostics(state.ip)
    .then(diagnostics => {
      if (diagnostics !== null) state.diagnostics = diagnostics
    })
    .finally(() => probing.delete(state.ip))
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
        refreshDiagnostics(state)
        // The findings are cheap and read the state the poll just wrote, so they
        // are evaluated every tick: a player that goes offline is then reported
        // at once instead of at the next diagnostic pass. The notifier speaks
        // only when a rule appears, which is why this call is not throttled.
        notifier?.push({
          host,
          device: state.name,
          findings: findingsFor({ state, diagnostics: state.diagnostics }),
        })
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

// The hosts the page owns, with what the last poll knows: the source decides
// what can be edited, and the online flag is what the list shows next to it.
const hostList = (): (HostEntry & { ip: string; online: boolean; name: string })[] =>
  hostEntries(hosts, { env: envHosts, saved: savedHosts }).map(entry => {
    const state = states.get(entry.host)
    return {
      ...entry,
      ip: state?.ip ?? entry.host,
      online: state?.online ?? false,
      name: state?.name ?? entry.host,
    }
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const sendHosts = (res: ServerResponse): void => {
  sendJson(res, 200, { hosts: hostList() })
}

const persistHosts = (): Promise<void> => writeHostsFile(hostsFile, [...savedHosts])

// Two spellings of one machine must not become two cards, and must not run two
// writers against it: the check discovery makes is the one a typed address gets
// too. `ignore` is the entry being renamed, which is allowed to collide with
// itself.
const clashFor = (host: string, ignore = ''): string | null => {
  const target = resolveTarget(host)
  for (const known of hosts) {
    if (known === host || known === ignore) continue
    if (resolveTarget(known) === target) return known
  }
  return null
}

// The hosts routes read a JSON body for the same reason the command route does:
// an HTML form cannot send that content type, so a cross-site post cannot make
// the hub poll an address of someone else's choosing.
const jsonBody = async (req: IncomingMessage, res: ServerResponse): Promise<unknown> => {
  const type = req.headers['content-type'] ?? ''
  if (!type.toLowerCase().includes('application/json')) {
    sendJson(res, 415, { error: 'content-type must be application/json' })
    return undefined
  }
  const raw = await readBody(req)
  if (raw === null) {
    sendJson(res, 413, { error: 'body too large' })
    return undefined
  }
  try {
    return JSON.parse(raw)
  } catch {
    sendJson(res, 400, { error: 'invalid json' })
    return undefined
  }
}

const addHostRoute = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await jsonBody(req, res)
  if (body === undefined) return
  const host = normalizeHost(isRecord(body) ? body.host : null)
  if (host === null) {
    sendJson(res, 400, { error: 'invalid host' })
    return
  }
  if (envHosts.has(host)) {
    sendJson(res, 409, { error: 'host comes from DEVICE_HOSTS' })
    return
  }
  if (savedHosts.has(host)) {
    sendJson(res, 409, { error: 'host already saved' })
    return
  }
  const clash = clashFor(host)
  if (clash !== null) {
    sendJson(res, 409, { error: `host already polled as ${clash}` })
    return
  }
  // A host discovery already found is kept rather than refused: that is how a
  // device the network sees becomes an entry the page owns and keeps across
  // restarts.
  savedHosts.add(host)
  hosts.add(host)
  await persistHosts()
  void pollAll()
  sendHosts(res)
}

const renameHostRoute = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await jsonBody(req, res)
  if (body === undefined) return
  const from = normalizeHost(isRecord(body) ? body.from : null)
  const to = normalizeHost(isRecord(body) ? body.to : null)
  if (from === null || to === null) {
    sendJson(res, 400, { error: 'invalid host' })
    return
  }
  if (envHosts.has(from)) {
    sendJson(res, 409, { error: 'host comes from DEVICE_HOSTS' })
    return
  }
  if (!savedHosts.has(from)) {
    // A discovered entry is not the page's, so repointing it would be a silent
    // adoption. Keeping it first is one click and says what happens.
    sendJson(res, hosts.has(from) ? 409 : 404, {
      error: hosts.has(from) ? 'host was found by discovery, save it first' : 'unknown host',
    })
    return
  }
  if (from === to) {
    sendHosts(res)
    return
  }
  if (envHosts.has(to) || savedHosts.has(to)) {
    sendJson(res, 409, { error: 'host already known' })
    return
  }
  const clash = clashFor(to, from)
  if (clash !== null) {
    sendJson(res, 409, { error: `host already polled as ${clash}` })
    return
  }
  savedHosts.delete(from)
  savedHosts.add(to)
  hosts.delete(from)
  hosts.add(to)
  // The card follows the entry: a state keyed by the old spelling would keep a
  // device nobody lists any more, and its history with it.
  states.delete(from)
  await persistHosts()
  void pollAll()
  sendHosts(res)
}

const removeHostRoute = async (url: URL, res: ServerResponse): Promise<void> => {
  const host = normalizeHost(url.searchParams.get('host'))
  if (host === null) {
    sendJson(res, 400, { error: 'invalid host' })
    return
  }
  if (envHosts.has(host)) {
    sendJson(res, 409, { error: 'host comes from DEVICE_HOSTS' })
    return
  }
  if (!savedHosts.has(host)) {
    const known = hosts.has(host)
    sendJson(res, known ? 409 : 404, {
      error: known
        ? 'host was found by discovery, it would come back on the next scan'
        : 'unknown host',
    })
    return
  }
  savedHosts.delete(host)
  hosts.delete(host)
  states.delete(host)
  await persistHosts()
  sendHosts(res)
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
  // The browser reads this one itself, and the manifest spec names the type:
  // served as octet-stream it is a download, not a manifest.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
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

// A stable order across polls and machines: a card must not jump when a second
// speaker answers or renames itself, and a reachable speaker comes before a
// silent one. Findings are derived, never stored: they are a reading of the
// state at the moment it is served, so a counter that recovered stops showing.
const sendState = (res: ServerResponse): void => {
  const devices = [...states.values()]
    .sort(
      (left, right) =>
        Number(right.online) - Number(left.online) ||
        left.name.localeCompare(right.name) ||
        left.ip.localeCompare(right.ip)
    )
    .map(state => ({
      ...state,
      findings: findingsFor({ state, diagnostics: state.diagnostics }),
      guides: guidesFor({ state, diagnostics: state.diagnostics }),
    }))
  sendJson(res, 200, { ts: Date.now(), pollMs, devices })
}

// The report is what a user pastes into a support thread: the findings, the
// evidence behind each of them, and the raw answers they came from.
const sendReport = async (url: URL, res: ServerResponse): Promise<void> => {
  const entry = findEntry(url.searchParams.get('host') ?? '')
  if (entry === null) {
    sendJson(res, 404, { error: 'unknown device' })
    return
  }
  const findings = findingsFor({ state: entry.state, diagnostics: entry.state.diagnostics })
  const guides = guidesFor({ state: entry.state, diagnostics: entry.state.diagnostics })
  // Probing eighteen commands costs about five seconds on a dead device and
  // says nothing useful there: an offline player is already the first finding.
  const inventory = entry.state.online ? await readInventory(entry.key) : null
  const resolution = resolutionFor(entry.key)
  const report = buildReport({
    state: entry.state,
    diagnostics: entry.state.diagnostics,
    findings,
    hub: { version: hubVersion, pollMs, slowPollMs, eventsEnabled },
    inventory,
    resolution,
    guides,
  })
  sendJson(res, 200, {
    ts: report.generatedAt,
    host: entry.key,
    findings,
    guides,
    inventory,
    resolution,
    markdown: report.markdown,
  })
}

// Settings are read when the sheet opens, not on every poll: the answer is a
// set of four writes nobody watches between visits.
const sendSettings = async (url: URL, res: ServerResponse): Promise<void> => {
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
}

// A route answers `true` when it handled the request. One it does not serve
// (another method) hands the request back, and the API branch below answers.
type Route = (url: URL, req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean>

const routes: Record<string, Route> = {
  '/health': (_url, _req, res) => {
    sendJson(res, 200, { ok: true, devices: states.size })
    return true
  },
  '/api/state': (_url, _req, res) => {
    sendState(res)
    return true
  },
  '/api/report': (url, _req, res) => sendReport(url, res).then(() => true),
  // The streaming table is reference data, not live state: the page reads it
  // when the diagnostic card opens, and the poll payload stays the size it was.
  '/api/services': async (url, _req, res) => {
    const entry = findEntry(url.searchParams.get('host') ?? '')
    if (entry === null) {
      sendJson(res, 404, { error: 'unknown device' })
      return true
    }
    // A silent player publishes nothing, and a probe against it costs a timeout
    // to learn the first finding again.
    const services = entry.state.online ? await readServices(entry.key) : []
    sendJson(res, 200, { ts: Date.now(), host: entry.key, services })
    return true
  },
  '/api/art': async (url, _req, res) => {
    await artFor(url, res)
    return true
  },
  '/api/settings': (url, _req, res) => sendSettings(url, res).then(() => true),
  '/api/command': async (url, req, res) => {
    if (req.method !== 'POST') return false
    await commandRoute(url, req, res)
    return true
  },
  '/api/discover': async (_url, req, res) => {
    if (req.method !== 'POST') return false
    const added = await refreshHosts()
    await pollAll()
    sendJson(res, 200, { ts: Date.now(), added, devices: states.size })
    return true
  },
  // One route for the list the page manages: reading it is what the dialog
  // does when it opens, and the three writes answer the new list so the page
  // never has to re-read to know what it got.
  '/api/hosts': async (url, req, res) => {
    if (req.method === 'GET') {
      sendHosts(res)
      return true
    }
    if (req.method === 'POST') {
      await addHostRoute(req, res)
      return true
    }
    if (req.method === 'PUT') {
      await renameHostRoute(req, res)
      return true
    }
    if (req.method === 'DELETE') {
      await removeHostRoute(url, res)
      return true
    }
    return false
  },
}

// A client-side route has no extension: hand it the shell and let the app
// decide. An unknown asset stays a 404 instead of silently returning HTML.
const servePage = async (pathname: string, res: ServerResponse): Promise<void> => {
  if (await serveFile(pathname, res)) return
  if (extname(pathname) === '' && (await serveFile('/index.html', res))) return
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
}

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : null
  if (route !== null && (await route(url, req, res))) return
  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  await servePage(url.pathname, res)
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
  if (eventsEnabled) {
    // A port already taken is the most likely failure here, and it must be said:
    // the hub keeps working on the fast poll, but nothing would explain why the
    // subscriptions never appear.
    await hub.start().catch(error => {
      console.error(
        `wiim-hub: UPnP callback could not listen on ${upnpPort}, polling only (${String(error)})`
      )
    })
  } else {
    console.log('wiim-hub: UPnP events off (UPNP_CALLBACK is empty)')
  }
  if (notifier === null) {
    console.log('wiim-hub: notifications off (NOTIFY_WEBHOOK and NOTIFY_NTFY are empty)')
  } else {
    console.log(`wiim-hub: notifications on (${notifier.channels.join(', ')})`)
  }
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

// Top-level await: the module is the process entry point, so nothing imports it
// and waiting here is the same as `void main()` with one difference, a failure
// is reported as the module failing instead of as an unhandled rejection.
await main()
