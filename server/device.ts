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

// A saved radio preset. The slot number is the identity: the list a device
// reports is sparse (slots 1 and 6 are a valid answer), so the array index is
// never a usable key.
export type Preset = { number: number; name: string; artwork: string }

// An output the hub is able to select. `hardware` is the integer the device
// expects in `setAudioOutputHardwareMode`, mapped from the mode name: the
// `index` field of `getSoundCardModeSupportList` is not documented as the same
// value, so an unknown mode name stays unselectable instead of being guessed.
export type OutputOption = { hardware: number; name: string }

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
  mode: string
  input: string
  maxVolume: number | null
  mute: boolean
  sleepSeconds: number | null
  inputs: string[]
  inputLabels: Record<string, string>
  outputs: OutputOption[]
  outputHardware: number | null
  presets: Preset[]
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
  mode: string
  input: string
  maxVolume: number | null
  mute: boolean
  sleepSeconds: number | null
  inputs: string[]
  inputLabels: Record<string, string>
  outputs: OutputOption[]
  outputHardware: number | null
  presets: Preset[]
}

export const MAX_SAMPLES = 400
export const MAX_EVENTS = 40

type Scheme = 'https' | 'http'

const transports = new Map<string, Scheme>()
const timeoutMs = 2500

// A device entry is a host: an address stays as is, a name is resolved on the
// network. Resolution never blocks a poll: a WiiM responder was measured
// answering between 0.5 s and 6 s, so waiting on it would stretch a 3 s poll
// and mark a reachable device offline. `known` keeps the last address that
// ever resolved, `attempts` throttles the queries.
type Resolution = { ip: string | null; at: number }
const attempts = new Map<string, Resolution>()
const known = new Map<string, string>()
const pending = new Set<string>()
const resolutionTtlMs = 30_000
const failureTtlMs = 60_000
const minAttemptGapMs = 5000

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

const refresh = (host: string): void => {
  if (pending.has(host)) return
  pending.add(host)
  void (async () => {
    try {
      const ip = (await lookupIp(host)) ?? (await resolveMdns(host))
      attempts.set(host, { ip, at: Date.now() })
      if (ip !== null) known.set(host, ip)
    } finally {
      pending.delete(host)
    }
  })()
}

// Returns the address to use right now and schedules a refresh when the
// knowledge is stale. The first call of a session returns the host itself:
// the poll fails once, the answer lands a few seconds later, the card follows.
export const resolveTarget = (host: string): string => {
  if (isIpLiteral(host)) return host
  const cached = attempts.get(host)
  const ttl = cached === undefined || cached.ip === null ? failureTtlMs : resolutionTtlMs
  const stale = cached === undefined || Date.now() - cached.at >= ttl
  const tooSoon = cached !== undefined && Date.now() - cached.at < minAttemptGapMs
  if (stale && !tooSoon) refresh(host)
  return known.get(host) ?? host
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
const cleanTitle = (value: string): string => (/^unknow?n?$/i.test(value.trim()) ? '' : value)

// The same firmware answers `un_known` for a cover it does not have: relaying
// that string produces a broken image on every poll of a stopped player.
const artUri = (value: string): string => {
  const uri = value.trim()
  return /^(un[_-]?known|-)$/i.test(uri) ? '' : uri
}

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

type Binary = { body: Buffer; type: string }

const maxArtBytes = 6 * 1024 * 1024

const getBinary = (ip: string, path: string, scheme: Scheme, port?: number, insecure = false): Promise<Binary | null> =>
  new Promise((resolve) => {
    const sender = scheme === 'https' ? httpsRequest : httpRequest
    const options = {
      host: ip,
      port: port ?? (scheme === 'https' ? 443 : 80),
      path,
      method: 'GET',
      timeout: 5000,
      headers: { accept: 'image/*' },
      ...(scheme === 'https' && insecure ? { rejectUnauthorized: false } : {}),
    }
    const req = sender(options, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        resolve(null)
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxArtBytes) {
          req.destroy()
          resolve(null)
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        const type = res.headers['content-type'] ?? 'image/jpeg'
        resolve({ body: Buffer.concat(chunks), type })
      })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
    req.end()
  })

// Album art reaches the browser through the hub, for two reasons: an https
// page cannot load the speaker's plain http cover (mixed content), and a
// streaming service sometimes hands out a URL that only resolves from the
// local network. The uri is only ever the one the device reported, which the
// route checks before calling here: this is not an open proxy.
export const fetchAlbumArt = async (host: string, uri: string): Promise<Binary | null> => {
  const deviceIp = resolveTarget(host)
  let target = deviceIp
  let port: number | undefined
  let path = uri
  let scheme: Scheme = transports.get(deviceIp) ?? 'https'
  try {
    const parsed = new URL(uri)
    target = parsed.hostname
    port = parsed.port === '' ? undefined : Number(parsed.port)
    path = `${parsed.pathname}${parsed.search}`
    scheme = parsed.protocol === 'http:' ? 'http' : 'https'
  } catch {
    if (!path.startsWith('/')) path = `/${path}`
  }
  // A self-signed certificate is expected on the speaker, never on a public
  // artwork host.
  const insecure = target === deviceIp
  const first = await getBinary(target, path, scheme, port, insecure)
  if (first !== null) return first
  return getBinary(target, path, scheme === 'https' ? 'http' : 'https', port, insecure)
}

const isArray = (value: unknown): value is unknown[] => Array.isArray(value)

const parseArray = (raw: string | null): unknown[] | null => {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    return isArray(value) ? value : null
  } catch {
    return null
  }
}

// Playback mode -> input id. Only the codes seen on a real player are mapped
// (10-19 is the device playlist over the network, then the analogue and
// digital inputs); anything else stays unknown rather than lighting up the
// wrong source.
const inputFromMode = (mode: string): string => {
  const code = Number.parseInt(mode, 10)
  if (Number.isFinite(code) && code >= 10 && code <= 19) return 'wifi'
  if (code === 40) return 'line-in'
  if (code === 41) return 'bluetooth'
  if (code === 43) return 'optical'
  return ''
}

// The integer `setAudioOutputHardwareMode` expects, by mode name. An output
// whose name is not in this table stays unselectable on purpose: writing a
// guessed integer would route the audio somewhere the user did not ask for.
const hardwareByOutputMode: Record<string, number> = {
  AUDIO_OUTPUT_SPDIF_MODE: 1,
  AUDIO_OUTPUT_AUX_MODE: 2,
  AUDIO_OUTPUT_COAX_MODE: 3,
  AUDIO_OUTPUT_BT_MODE: 4,
  AUDIO_OUTPUT_USB_MODE: 8,
}

type Capability = { at: number; inputs: string[]; inputLabels: Record<string, string>; outputs: OutputOption[] }

const capabilityTtlMs = 300_000
const capabilityCache = new Map<string, Capability>()

// Inputs come from two places: the physical list the model reports, then the
// inputs the user left enabled in the vendor app. A disabled input is kept
// when the device reports it as present, because the hardware did not vanish;
// only an input the user enabled but the capability list missed is added.
const readInputs = (capabilityRaw: string | null, enableRaw: string | null): string[] => {
  const list: string[] = []
  const capability = parseJson(capabilityRaw)
  if (Array.isArray(capability?.audioInput)) {
    for (const entry of capability.audioInput) {
      if (!isRecord(entry)) continue
      const mode = text(entry.mode)
      if (mode !== '' && !list.includes(mode)) list.push(mode)
    }
  }
  const enable = parseJson(enableRaw)
  if (Array.isArray(enable?.audioInput)) {
    for (const entry of enable.audioInput) {
      if (!isRecord(entry)) continue
      const mode = text(entry.mode)
      if (mode !== '' && num(entry.enable) === 1 && !list.includes(mode)) list.push(mode)
    }
  }
  return list
}

const readLabels = (raw: string | null): Record<string, string> => {
  const parsed = parseJson(raw)
  if (parsed === null) return {}
  const labels: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value !== '') labels[key] = value
  }
  return labels
}

const readOutputs = (raw: string | null): OutputOption[] => {
  const parsed = parseArray(raw)
  if (parsed === null) return []
  const outputs: OutputOption[] = []
  for (const entry of parsed) {
    if (!isRecord(entry) || !isRecord(entry.soundCard)) continue
    const hardware = hardwareByOutputMode[text(entry.mode)]
    const name = text(entry.soundCard.devName)
    if (hardware === undefined || name === '') continue
    if (outputs.some((output) => output.hardware === hardware)) continue
    outputs.push({ hardware, name })
  }
  return outputs
}

const emptyCapability = (): Capability => ({ at: 0, inputs: [], inputLabels: {}, outputs: [] })

// Probing a capability costs four requests and the answer almost never
// changes: cache it per address, and never let a failed probe erase what was
// already known.
const capabilityFor = async (ip: string): Promise<Capability> => {
  const cached = capabilityCache.get(ip)
  if (cached !== undefined && Date.now() - cached.at < capabilityTtlMs) return cached
  const [capabilityRaw, enableRaw, renameRaw, outputRaw] = await Promise.all([
    fetchCommand(ip, 'getAudioInputCapbility'),
    fetchCommand(ip, 'getAudioInputEnable'),
    fetchCommand(ip, 'getModeRename'),
    fetchCommand(ip, 'getSoundCardModeSupportList'),
  ])
  const inputs = readInputs(capabilityRaw, enableRaw)
  const outputs = readOutputs(outputRaw)
  if (inputs.length === 0 && outputs.length === 0) return cached ?? emptyCapability()
  const value: Capability = { at: Date.now(), inputs, inputLabels: readLabels(renameRaw), outputs }
  capabilityCache.set(ip, value)
  return value
}

const presetTtlMs = 60_000
const presetCache = new Map<string, { at: number; value: Preset[] }>()

const presetsFor = async (ip: string): Promise<Preset[]> => {
  const cached = presetCache.get(ip)
  if (cached !== undefined && Date.now() - cached.at < presetTtlMs) return cached.value
  const info = parseJson(await fetchCommand(ip, 'getPresetInfo'))
  const entries = Array.isArray(info?.preset_list) ? info.preset_list : null
  if (entries === null) return cached?.value ?? []
  const value: Preset[] = []
  for (const entry of entries) {
    if (!isRecord(entry)) continue
    const number = num(entry.number)
    if (number === null || number <= 0) continue
    value.push({ number, name: text(entry.name) || String(number), artwork: artUri(text(entry.picurl)) })
  }
  value.sort((left, right) => left.number - right.number)
  presetCache.set(ip, { at: Date.now(), value })
  return value
}

// `host` is either an address or a resolvable name (`salon.local`), so the
// caller never has to care which one the configuration carries.
export const pollDevice = async (host: string): Promise<DevicePatch> => {
  const ip = resolveTarget(host)
  const [statusRaw, playerRaw, metaRaw, outputRaw, sleepRaw] = await Promise.all([
    fetchCommand(ip, 'getStatusEx'),
    fetchCommand(ip, 'getPlayerStatusEx'),
    fetchCommand(ip, 'getMetaInfo'),
    fetchCommand(ip, 'getNewAudioOutputHardwareMode'),
    fetchCommand(ip, 'getShutdown'),
  ])
  const status = parseJson(statusRaw)
  const player = parseJson(playerRaw)
  const meta = parseJson(metaRaw)
  const output = parseJson(outputRaw)
  const metaData = meta && isRecord(meta.metaData) ? meta.metaData : {}
  const online = status !== null
  if (!online) forgetTarget(host)
  const groupId = text(status?.group)
  // The group command costs one more request: ask only when the device says
  // it belongs to a group, instead of on every poll of a standalone speaker.
  const grouped = groupId !== '' && groupId !== '0'
  const slavesRaw = grouped ? parseJson(await fetchCommand(ip, 'multiroom:getSlaveList')) : null
  const capability = online ? await capabilityFor(ip) : (capabilityCache.get(ip) ?? emptyCapability())
  const presets = online ? await presetsFor(ip) : (presetCache.get(ip)?.value ?? [])
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
    artist: cleanTitle(text(metaData.artist)),
    album: cleanTitle(text(metaData.album)),
    albumArt: artUri(text(metaData.albumArtURI)),
    curposMs: num(player?.curpos),
    totalMs: num(player?.totlen),
    source: text(player?.vendor),
    slaves: num(slavesRaw?.slaves) ?? 0,
    mode: text(player?.mode),
    input: inputFromMode(text(player?.mode)),
    maxVolume: num(status?.max_volume),
    mute: num(player?.mute) === 1,
    sleepSeconds: num(sleepRaw),
    inputs: capability.inputs,
    inputLabels: capability.inputLabels,
    outputs: capability.outputs,
    outputHardware: num(output?.hardware),
    presets,
  }
}
