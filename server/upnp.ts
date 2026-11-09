// UPnP eventing: the player pushes its changes instead of being polled for
// them. Measured on the reference player (WiiM Pro, Linkplay.4.8.833748):
//
// - `SUBSCRIBE` to `/upnp/event/rendertransport1` or `/upnp/event/rendercontrol1`
//   on port 49152 answers 200, a `SID` and `TIMEOUT: Second-300`.
// - An initial `NOTIFY` (SEQ=0) follows immediately with the whole state, then
//   one notification per change: a volume or mute write is delivered in under
//   100 ms, with `SEQ` incremented by one.
// - The body is a `propertyset` whose single `LastChange` property carries an
//   escaped `Event` document; the track metadata is escaped a second time
//   inside `CurrentTrackMetaData`.
// - Transport wording is UPnP (`PLAYING`, `PAUSED_PLAYBACK`, `STOPPED`), not the
//   hub's own `play`/`pause`/`stop` tokens.
// - Nothing here carries the position: the progress bar keeps its polled
//   values. The counters, the group, the inputs and the equalizer are not
//   evented either, so a slow poll stays necessary; the subscription only
//   shortens the latency of what it does carry.
// - The device pushes to the `CALLBACK` it was given, so the hub must be
//   reachable from the player: a container behind a bridge network is not.
//   `UPNP_CALLBACK` names that reachable base and stays empty by default.
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

// The UPnP description lives on this port on every LinkPlay player seen so far.
// It stays an option so a test can drive a fake device on a port it owns.
const defaultDevicePort = 49152

// Only two of the five advertised services carry playback state. The renderer
// service is enough for the transport, the rendering one for volume and mute;
// the connection manager only publishes protocol lists.
const services = ['AVTransport', 'RenderingControl'] as const
type Service = (typeof services)[number]

const defaults: Record<Service, string> = {
  AVTransport: '/upnp/event/rendertransport1',
  RenderingControl: '/upnp/event/rendercontrol1',
}

export type EventPatch = {
  status?: string
  volume?: number
  mute?: boolean
  title?: string
  artist?: string
  album?: string
  albumArt?: string
  totalMs?: number
}

export type EventState = 'off' | 'subscribed' | 'degraded'
export type EventStatus = {
  state: EventState
  lastEventAt: number | null
  events: number
  misses: number
}

// A repeated header arrives as an array: only the single value spells a SID.
const header = (req: IncomingMessage, name: string): string => {
  const value = req.headers[name]
  return typeof value === 'string' ? value : ''
}

const decodeEntities = (value: string): string =>
  value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')

// `HH:MM:SS`, optionally with a fraction. The device sends `00:00:00` for an
// input with no media, which is a duration of zero, not a missing one.
export const parseDuration = (value: string): number | null => {
  const match = /^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(value.trim())
  if (match === null) return null
  const [, hours, minutes, seconds, fraction] = match
  const millis = Number((fraction ?? '').padEnd(3, '0') || 0)
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + millis
}

const transportStates: Record<string, string> = {
  PLAYING: 'play',
  PAUSED_PLAYBACK: 'pause',
  PAUSED_RECORDING: 'pause',
  STOPPED: 'stop',
  NO_MEDIA_PRESENT: 'stop',
}

// An unmapped state stays out of the patch: the polled value is more truthful
// than a guess, and `TRANSITIONING` lands there.
export const transportStatus = (value: string): string | null =>
  transportStates[value.trim().toUpperCase()] ?? null

const attribute = (xml: string, name: string): string | null => {
  const match = new RegExp(String.raw`<${name}\b[^>]*?\bval="([^"]*)"`).exec(xml)
  return match === null ? null : match[1]
}

const element = (xml: string, name: string): string | null => {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)
  return match === null ? null : match[1].trim()
}

// The notification body is machine generated and flat: five tags deep at most,
// so regular expressions read it without pulling an XML parser into a server
// that runs with no dependency at all. Every read is optional, and a field that
// is absent leaves the polled value alone.
export const parseLastChange = (body: string): EventPatch => {
  const event = decodeEntities(body)
  const patch: EventPatch = {}
  const status = transportStatus(attribute(event, 'TransportState') ?? '')
  if (status !== null) patch.status = status
  const volume = Number.parseInt(attribute(event, 'Volume') ?? '', 10)
  if (Number.isFinite(volume)) patch.volume = volume
  const mute = attribute(event, 'Mute')
  if (mute === '0' || mute === '1') patch.mute = mute === '1'
  const duration = attribute(event, 'CurrentTrackDuration')
  const totalMs = duration === null ? null : parseDuration(duration)
  if (totalMs !== null) patch.totalMs = totalMs
  const metadata = attribute(event, 'CurrentTrackMetaData')
  if (metadata !== null && metadata !== '') {
    // The DIDL document sits inside an attribute, so it is escaped once more
    // than the rest of the event.
    const didl = decodeEntities(metadata)
    const title = element(didl, 'dc:title')
    if (title !== null) patch.title = title
    const artist = element(didl, 'upnp:artist')
    if (artist !== null) patch.artist = artist
    const album = element(didl, 'upnp:album')
    if (album !== null) patch.album = album
    const art = element(didl, 'upnp:albumArtURI')
    if (art !== null) patch.albumArt = art
  }
  return patch
}

// Silence is the normal case for a player nobody touches, so age proves
// nothing. A subscription is degraded when its renewal failed or when polls
// contradicted it (the `misses` counter of the hub); the entry is kept so the
// page can say why the fast poll came back instead of looking like a hub that
// never tried.
export const eventState = (input: { subscribed: boolean; misses: number }): EventState => {
  if (input.misses >= 2) return 'degraded'
  if (!input.subscribed) return 'off'
  return 'subscribed'
}

export type EventHub = {
  start: () => Promise<void>
  subscribe: (ip: string) => Promise<boolean>
  unsubscribe: (ip: string) => void
  status: (ip: string) => EventStatus
  isSubscribed: (ip: string) => boolean
  markMiss: (ip: string) => void
  clearMiss: (ip: string) => void
  close: () => Promise<void>
}

type Entry = {
  ip: string
  port: number
  paths: Record<Service, string>
  token: string
  sids: Partial<Record<Service, string>>
  // Last `SEQ` seen, keyed by SID: each subscription counts on its own.
  seq: Record<string, number>
  expiresAt: number
  renewAt: number
  lastEventAt: number | null
  events: number
  misses: number
  subscribed: boolean
  timer: NodeJS.Timeout | null
}

export type EventHubOptions = {
  /** Port of the callback listener the player can reach. */
  port: number
  /** Port the player answers UPnP on, 49152 unless a test says otherwise. */
  devicePort?: number
  /** Base URL of that listener, e.g. `http://192.168.1.146:8091`. */
  callbackBase: string
  onPatch: (ip: string, patch: EventPatch) => void
  log?: (message: string) => void
  timeoutSeconds?: number
  renewRatio?: number
  now?: () => number
}

const subscribeTo = async (
  target: { ip: string; port: number },
  path: string,
  callback: string,
  timeoutSeconds: number
): Promise<{ sid: string; timeout: number } | null> => {
  try {
    const response = await fetch(`http://${target.ip}:${target.port}${path}`, {
      method: 'SUBSCRIBE',
      headers: {
        CALLBACK: `<${callback}>`,
        NT: 'upnp:event',
        TIMEOUT: `Second-${timeoutSeconds}`,
      },
      signal: AbortSignal.timeout(5000),
    })
    const sid = response.headers.get('sid')
    if (!response.ok || sid === null) return null
    const granted = /Second-(\d+)/i.exec(response.headers.get('timeout') ?? '')
    return { sid, timeout: granted === null ? timeoutSeconds : Number(granted[1]) }
  } catch {
    return null
  }
}

const unsubscribeFrom = async (
  target: { ip: string; port: number },
  path: string,
  sid: string
): Promise<void> => {
  try {
    await fetch(`http://${target.ip}:${target.port}${path}`, {
      method: 'UNSUBSCRIBE',
      headers: { SID: sid },
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // The device may already be gone: the subscription expires on its own.
  }
}

// Some firmwares rename the event paths, so the description is read once and
// the measured defaults only answer when the device advertises no service at
// all.
const readEventPaths = async (target: {
  ip: string
  port: number
}): Promise<Record<Service, string>> => {
  const paths: Record<Service, string> = { ...defaults }
  try {
    const response = await fetch(`http://${target.ip}:${target.port}/description.xml`, {
      signal: AbortSignal.timeout(5000),
    })
    const xml = await response.text()
    for (const service of services) {
      const block = new RegExp(
        String.raw`<service>(?:(?!</service>)[\s\S])*${service}[\s\S]*?</service>`
      ).exec(xml)?.[0]
      const path =
        block === undefined ? null : /<eventSubURL>([^<]+)<\/eventSubURL>/.exec(block)?.[1]
      if (path !== undefined && path !== null) paths[service] = path
    }
  } catch {
    // Keep the measured paths: the subscription attempt tells the truth.
  }
  return paths
}

export const createEventHub = (options: EventHubOptions): EventHub => {
  const now = options.now ?? Date.now
  const timeoutSeconds = options.timeoutSeconds ?? 300
  const renewRatio = options.renewRatio ?? 0.8
  const log = options.log ?? (() => undefined)
  const entries = new Map<string, Entry>()
  const tokens = new Map<string, Entry>()
  let server: ReturnType<typeof createServer> | null = null

  const statusOf = (entry: Entry | undefined): EventStatus => ({
    state:
      entry === undefined
        ? 'off'
        : eventState({ subscribed: entry.subscribed, misses: entry.misses }),
    lastEventAt: entry?.lastEventAt ?? null,
    events: entry?.events ?? 0,
    misses: entry?.misses ?? 0,
  })

  const release = (entry: Entry): void => {
    if (entry.timer !== null) clearTimeout(entry.timer)
    entry.timer = null
    for (const service of services) {
      const sid = entry.sids[service]
      if (sid !== undefined) {
        void unsubscribeFrom({ ip: entry.ip, port: entry.port }, entry.paths[service], sid)
      }
    }
    entry.sids = {}
  }

  const renew = async (entry: Entry): Promise<void> => {
    for (const service of services) {
      const sid = entry.sids[service]
      if (sid === undefined) continue
      // A renewal keeps the same SID: the device extends the life of the
      // subscription instead of opening a second one.
      try {
        const response = await fetch(`http://${entry.ip}:${entry.port}${entry.paths[service]}`, {
          method: 'SUBSCRIBE',
          headers: { SID: sid, TIMEOUT: `Second-${timeoutSeconds}` },
          signal: AbortSignal.timeout(5000),
        })
        if (!response.ok) throw new Error(String(response.status))
      } catch {
        log(`wiim-hub: UPnP renewal failed for ${entry.ip} (${service}), falling back to polling`)
        // The entry stays, without its token: the status has to read `degraded`
        // until the retry loop subscribes again.
        entry.subscribed = false
        entry.misses = Math.max(entry.misses, 2)
        release(entry)
        tokens.delete(entry.token)
        return
      }
    }
    const grantedMs = timeoutSeconds * 1000
    entry.expiresAt = now() + grantedMs
    entry.renewAt = now() + Math.round(grantedMs * renewRatio)
    entry.timer = setTimeout(() => void renew(entry), Math.max(50, grantedMs * renewRatio))
    entry.timer.unref()
  }

  const refuse = (res: ServerResponse, reason: string): void => {
    log(`wiim-hub: UPnP notification refused (${reason})`)
    res.writeHead(404)
    res.end()
  }

  const handleNotify = (req: IncomingMessage, res: ServerResponse, body: string): void => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const token = url.pathname.startsWith('/upnp/') ? url.pathname.slice('/upnp/'.length) : ''
    const entry = tokens.get(token)
    const source = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
    // Two refusals, told apart on purpose: an unknown token means the path is not
    // one we handed out, a source mismatch means the notification comes from
    // another host than the device we subscribed to.
    if (entry === undefined) {
      refuse(res, token === '' ? 'no token' : 'unknown token')
      return
    }
    if (entry.ip !== source) {
      refuse(res, `source ${source} is not ${entry.ip}`)
      return
    }
    // A notification that arrives twice or out of order is the network, not a
    // state change: the sequence number is per subscription, so the SID keys
    // it. The SID is not looked up against the ones we recorded: the initial
    // notification can reach the listener before the device's answer has been
    // read, and the token plus the source address already prove the sender.
    const sid = header(req, 'sid')
    if (sid === '') {
      res.writeHead(412)
      res.end()
      return
    }
    const seq = Number.parseInt(header(req, 'seq'), 10)
    const previous = entry.seq[sid] ?? -1
    if (Number.isFinite(seq) && seq <= previous) {
      res.writeHead(200)
      res.end()
      return
    }
    if (Number.isFinite(seq)) entry.seq[sid] = seq
    const patch = parseLastChange(body)
    entry.lastEventAt = now()
    entry.events += 1
    entry.misses = 0
    options.onPatch(entry.ip, patch)
    res.writeHead(200)
    res.end()
  }

  const start = async (): Promise<void> => {
    server = createServer((req, res) => {
      if (req.method !== 'NOTIFY') {
        // The listener exists for the players only: it answers no other verb
        // and serves no other path, so it cannot become a second API surface.
        res.writeHead(404)
        res.end()
        return
      }
      let body = ''
      let size = 0
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 64 * 1024) {
          req.destroy()
          return
        }
        body += chunk.toString('utf8')
      })
      req.on('end', () => handleNotify(req, res, body))
      req.on('error', () => res.destroy())
    })
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject)
      server?.listen(options.port, () => resolve())
    })
    log(`wiim-hub: UPnP callback listening on ${options.port} (${options.callbackBase})`)
  }

  const subscribe = async (ip: string): Promise<boolean> => {
    if (server === null) return false
    const existing = entries.get(ip)
    if (existing?.subscribed) return true
    const port2 = options.devicePort ?? defaultDevicePort
    const paths = await readEventPaths({ ip, port: port2 })
    const entry: Entry = {
      ip,
      port: port2,
      paths,
      token: randomBytes(12).toString('hex'),
      sids: {},
      seq: {},
      expiresAt: 0,
      renewAt: 0,
      lastEventAt: null,
      events: 0,
      misses: 0,
      subscribed: false,
      timer: null,
    }
    const callback = `${options.callbackBase.replace(/\/$/, '')}/upnp/${entry.token}`
    // The device sends its initial notification the moment it answers the
    // subscription, so the entry must already be reachable when the first
    // SUBSCRIBE goes out. `subscribed` stays false until both services hold a
    // SID, and a refusal cleans the entry up.
    entries.set(ip, entry)
    tokens.set(entry.token, entry)
    let grantedMs = 0
    for (const service of services) {
      const result = await subscribeTo(
        { ip, port: port2 },
        paths[service],
        callback,
        timeoutSeconds
      )
      if (result === null) {
        release(entry)
        entries.delete(ip)
        tokens.delete(entry.token)
        log(`wiim-hub: UPnP subscription refused by ${ip} (${service}), polling stays`)
        return false
      }
      entry.sids[service] = result.sid
      grantedMs = Math.max(grantedMs, result.timeout * 1000)
    }
    entry.subscribed = true
    entry.expiresAt = now() + grantedMs
    entry.renewAt = now() + Math.round(grantedMs * renewRatio)
    entry.timer = setTimeout(() => void renew(entry), Math.max(50, grantedMs * renewRatio))
    entry.timer.unref()
    log(`wiim-hub: UPnP events subscribed for ${ip} (${Math.round(grantedMs / 1000)} s)`)
    return true
  }

  const unsubscribe = (ip: string): void => {
    const entry = entries.get(ip)
    if (entry === undefined) return
    release(entry)
    entries.delete(ip)
    tokens.delete(entry.token)
  }

  const isSubscribed = (ip: string): boolean => entries.get(ip)?.subscribed === true

  const markMiss = (ip: string): void => {
    const entry = entries.get(ip)
    if (entry === undefined) return
    entry.misses += 1
    if (entry.misses >= 2 && entry.subscribed) {
      log(`wiim-hub: UPnP events contradicted by polling for ${ip}, falling back`)
      release(entry)
      entry.subscribed = false
      // The token goes with the subscription: a late notification must not
      // refresh a channel the hub has already stopped trusting.
      tokens.delete(entry.token)
    }
  }

  const clearMiss = (ip: string): void => {
    const entry = entries.get(ip)
    if (entry !== undefined) entry.misses = 0
  }

  const close = async (): Promise<void> => {
    for (const entry of entries.values()) {
      release(entry)
      tokens.delete(entry.token)
    }
    entries.clear()
    await new Promise<void>(resolve => {
      if (server === null) {
        resolve()
        return
      }
      server.close(() => resolve())
      server = null
    })
  }

  return {
    start,
    subscribe,
    unsubscribe,
    status: ip => statusOf(entries.get(ip)),
    isSubscribed,
    markMiss,
    clearMiss,
    close,
  }
}
