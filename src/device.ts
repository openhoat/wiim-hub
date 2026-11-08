import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIpLiteral, resolveMdns } from './mdns.ts'

export type Sample = {
  t: number
  rssi: number | null
  volume: number | null
  status: string
  online: boolean
}

export type DeviceEvent = {
  t: number
  kind: 'online' | 'offline' | 'status' | 'track'
  // Machine values, never a sentence: the browser holds the translations and
  // formats the transition itself.
  from: string
  to: string
}

export type DeviceState = {
  ip: string
  name: string
  model: string
  firmware: string
  release: string
  ssid: string
  bssid: string
  group: string
  rssi: number | null
  volume: number | null
  status: string
  title: string
  artist: string
  album: string
  albumArt: string
  curposMs: number | null
  totalMs: number | null
  source: string
  slaves: number
  updatedAt: number | null
  online: boolean
  lastSeen: number | null
  errors: number
  samples: Sample[]
  events: DeviceEvent[]
}

export type DevicePatch = {
  ip: string
  online: boolean
  name: string
  model: string
  firmware: string
  release: string
  ssid: string
  bssid: string
  group: string
  rssi: number | null
  volume: number | null
  status: string
  title: string
  artist: string
  album: string
  albumArt: string
  curposMs: number | null
  totalMs: number | null
  source: string
  slaves: number
}

export const MAX_SAMPLES = 400
export const MAX_EVENTS = 40

type Scheme = 'https' | 'http'

const transports = new Map<string, Scheme>()
const timeoutMs = 2500

// A device entry is a host: an address stays as is, a name is resolved on the
// network. Two maps, because a failed attempt must not erase the address that
// worked: `attempts` throttles resolution (a slow mDNS query is expensive and
// must not run on every poll), `known` keeps the last address that ever
// resolved, so an outage reads as a stale address rather than a lost device.
type Resolution = { ip: string | null; at: number }
const attempts = new Map<string, Resolution>()
const known = new Map<string, string>()
const resolutionTtlMs = 30_000
const failureTtlMs = 15_000

// The system resolver first: on a machine with nss-mdns it answers `.local`
// instantly, and it costs nothing elsewhere. The built-in mDNS query covers
// hosts where getaddrinfo has no mDNS path, containers included.
const lookupIp = async (host: string): Promise<string | null> => {
  try {
    const result = await lookup(host, { family: 4 })
    return result.address
  } catch {
    return null
  }
}

export const resolveTarget = async (host: string): Promise<string> => {
  if (isIpLiteral(host)) return host
  const cached = attempts.get(host)
  if (cached !== undefined) {
    const ttl = cached.ip === null ? failureTtlMs : resolutionTtlMs
    if (Date.now() - cached.at < ttl) return cached.ip ?? known.get(host) ?? host
  }
  const ip = (await lookupIp(host)) ?? (await resolveMdns(host))
  attempts.set(host, { ip, at: Date.now() })
  if (ip !== null) known.set(host, ip)
  return ip ?? known.get(host) ?? host
}

// Mark the attempt stale rather than dropping it: the next poll resolves
// again (a new DHCP lease), and the last known address stays as the fallback.
const forgetTarget = (host: string): void => {
  const cached = attempts.get(host)
  if (cached !== undefined) attempts.set(host, { ip: cached.ip, at: 0 })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const parseJson = (raw: string | null): Record<string, unknown> | null => {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

const num = (value: unknown): number | null => {
  const parsed = Number.parseInt(text(value), 10)
  return Number.isFinite(parsed) ? parsed : null
}

// getStatusEx repeats the field with a lowercase key on some builds and as
// RSSI on others: read both, keep the first numeric value.
const readRssi = (status: Record<string, unknown> | null): number | null =>
  num(status?.RSSI) ?? num(status?.rssi)

const cleanModel = (value: string): string => value.replace(/_with_.*$/i, '').replace(/_/g, ' ').trim()

// Idle firmware reports the placeholder "Unknown" as the track title: it is a
// device artefact, not a track, so it must not reach the card.
const cleanTitle = (value: string): string => (/^unknown$/i.test(value.trim()) ? '' : value)

// Firmware encodes some strings as hex (essid, Title): decode only when the
// bytes read as printable text, so numeric values stay untouched.
const maybeHex = (value: string): string => {
  if (value.length >= 6 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value)) {
    const decoded = Buffer.from(value, 'hex').toString('utf8')
    if (/^[\p{L}\p{N}\s\p{P}]+$/u.test(decoded)) return decoded
  }
  return value
}

const getOnce = (ip: string, command: string, scheme: Scheme): Promise<string | null> =>
  new Promise((resolve) => {
    const sender = scheme === 'https' ? httpsRequest : httpRequest
    const options = {
      host: ip,
      port: scheme === 'https' ? 443 : 80,
      path: `/httpapi.asp?command=${command}`,
      method: 'GET',
      timeout: timeoutMs,
      headers: { accept: 'application/json, text/plain, */*' },
      ...(scheme === 'https' ? { rejectUnauthorized: false } : {}),
    }
    const req = sender(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
    req.end()
  })

// Recent firmware moved the local API to https/443; older builds answer on
// http/80. Try the remembered transport first, then the other one, so a mixed
// fleet costs at most one double request per device.
export const fetchCommand = async (ip: string, command: string): Promise<string | null> => {
  const preferred = transports.get(ip) ?? 'https'
  const first = await getOnce(ip, command, preferred)
  if (first !== null) return first
  const fallback: Scheme = preferred === 'https' ? 'http' : 'https'
  const second = await getOnce(ip, command, fallback)
  if (second !== null) transports.set(ip, fallback)
  return second
}

// `host` is either an address or a resolvable name (`salon.local`), so the
// caller never has to care which one the configuration carries.
export const pollDevice = async (host: string): Promise<DevicePatch> => {
  const ip = await resolveTarget(host)
  const [statusRaw, playerRaw, metaRaw] = await Promise.all([
    fetchCommand(ip, 'getStatusEx'),
    fetchCommand(ip, 'getPlayerStatusEx'),
    fetchCommand(ip, 'getMetaInfo'),
  ])
  const status = parseJson(statusRaw)
  const player = parseJson(playerRaw)
  const meta = parseJson(metaRaw)
  const metaData = meta && isRecord(meta.metaData) ? meta.metaData : {}
  const online = status !== null
  if (!online) forgetTarget(host)
  const groupId = text(status?.group)
  // The group command costs one more request: ask only when the device says
  // it belongs to a group, instead of on every poll of a standalone speaker.
  const grouped = groupId !== '' && groupId !== '0'
  const slavesRaw = grouped ? parseJson(await fetchCommand(ip, 'multiroom:getSlaveList')) : null
  return {
    ip,
    online,
    name: text(status?.DeviceName) || host,
    model: cleanModel(text(status?.model) || text(status?.project)),
    firmware: text(status?.firmware),
    release: text(status?.Release),
    ssid: maybeHex(text(status?.essid)),
    bssid: text(status?.BSSID),
    group: text(status?.GroupName),
    rssi: readRssi(status),
    volume: num(player?.vol),
    status: text(player?.status),
    title: cleanTitle(text(metaData.title) || maybeHex(text(player?.Title))),
    artist: text(metaData.artist),
    album: text(metaData.album),
    albumArt: text(metaData.albumArtURI),
    curposMs: num(player?.curpos),
    totalMs: num(player?.totlen),
    source: text(player?.vendor),
    slaves: num(slavesRaw?.slaves) ?? 0,
  }
}
