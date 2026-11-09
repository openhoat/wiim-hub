import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { isIpLiteral, resolveMdns } from './mdns.ts'
import type { EventStatus } from './upnp.ts'

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

// A member of a multiroom group. A running group carries the address the
// device knows for it; a saved group only keeps the name and the uuid the
// firmware assigned, which is not the MAC on every model.
export type GroupMember = { name: string; ip: string; uuid: string }

// Multiroom, read only for now. `role` is what this speaker does in the group,
// `members` is what the device lists right now, and `saved` says a persistent
// group exists through `current_group_id` while nothing runs. `name` comes from
// the registry, never from `GroupName`: that field carries the device's own
// name on this firmware ("Living Room" for a speaker in no group at all).
export type GroupState = {
  role: 'none' | 'master' | 'member'
  name: string
  members: GroupMember[]
  saved: boolean
}

// An output the hub is able to select. `hardware` is the integer the device
// expects in `setAudioOutputHardwareMode`, mapped from the mode name: the
// `index` field of `getSoundCardModeSupportList` is not documented as the same
// value, so an unknown mode name stays unselectable instead of being guessed.
export type OutputOption = { hardware: number; name: string }

// One band of the graphic equalizer, as the device spells it (`band31hz`). The
// curve is per source on the device, so `Equalizer.source` names the one the
// bands belong to: a write must target that source, never a hardcoded one.
export type EqBand = { name: string; value: number }

export type Equalizer = {
  enabled: boolean
  // Empty once a band was moved by hand: the device drops the factory name and
  // the curve becomes custom.
  name: string
  source: string
  bands: EqBand[]
  presets: string[]
  // RoomFit (room correction) is reported as a capability: read-only here, the
  // write payload was never measured on a device.
  roomFit: boolean
}

// What `getMetaInfo` says about the stream itself: the numbers behind "is this
// really lossless".
export type Quality = { sampleRate: number | null; bitDepth: number | null; bitRate: number | null }

// The radio, as `getStatusEx` reports it on the reference player: RSSI -53 dBm,
// noise -91, SNR 35, 5260 MHz, 433 Mb/s. They ride the poll because the command
// that carries them is already in the cycle, and they are what turns "the Wi-Fi
// looks fine" into a number.
export type LinkMetrics = {
  snr: number | null
  noise: number | null
  freqMhz: number | null
  rateMbps: number | null
}

// The three probes behind the diagnostic findings, measured on the reference
// player on 09/11/2026. They change slowly, so they are refreshed on their own
// cadence instead of riding every poll.
export type Diagnostics = {
  at: number
  health: {
    disconnected: number | null
    ethDisconnected: number | null
    pingFailures: number | null
    abnormalReboots: number | null
    roaming: boolean
    band: number | null
    lastMessage: string
    lastMinutes: number | null
  } | null
  debug: {
    uptimeTicks: number | null
    crashes: {
      controller: number | null
      asrTts: number | null
      mcu: number | null
      deadlock: number | null
    }
    upnpActionsLost: number | null
    upnpActionsTotal: number | null
  } | null
  hardware: {
    ethError: boolean
    mfiError: boolean
    flashSpaceError: boolean
    soundCardError: boolean
    badBlocks: number | null
    totalBlocks: number | null
  } | null
}

export type DeviceState = {
  ip: string
  name: string
  model: string
  firmware: string
  release: string
  ssid: string
  bssid: string
  // The multiroom protocol version `getStatusEx` reports ("4.3" here). Empty
  // means the device does not answer the group commands at all, which is the
  // first thing to rule out when a group refuses to form.
  wmrmVersion: string
  group: GroupState
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
  eq: Equalizer
  quality: Quality
  updatedAt: number | null
  online: boolean
  lastSeen: number | null
  errors: number
  // The UPnP subscription behind the playback fields: `subscribed` means the
  // device pushes volume, mute and transport changes, `degraded` means a poll
  // contradicted it and the hub is back on the fast poll.
  upnp: EventStatus
  link: LinkMetrics
  diagnostics: Diagnostics | null
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
  // The multiroom protocol version `getStatusEx` reports ("4.3" here). Empty
  // means the device does not answer the group commands at all, which is the
  // first thing to rule out when a group refuses to form.
  wmrmVersion: string
  group: GroupState
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
  eq: Equalizer
  quality: Quality
  link: LinkMetrics
}

export const MAX_SAMPLES = 400
export const MAX_EVENTS = 40

export type Scheme = 'https' | 'http'

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

// `getStatusEx` answers strings ("-53"), while the diagnostic counters of
// `getNetworkHealth` and `getHwErrorInfo` come back as numbers (2, 5, 2000):
// reading only strings left every one of those counters null, and a rule that
// reads a null counter stays silent. The verbose field names are part of the
// firmware, not a quirk of one build.
const num = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const parsed = Number.parseInt(text(value), 10)
  return Number.isFinite(parsed) ? parsed : null
}

// getStatusEx repeats the field with a lowercase key on some builds and as
// RSSI on others: read both, keep the first numeric value.
const readRssi = (status: Record<string, unknown> | null): number | null =>
  num(status?.RSSI) ?? num(status?.rssi)

const cleanModel = (value: string): string =>
  value
    .replace(/_with_.*$/i, '')
    .replaceAll('_', ' ')
    .trim()

// Idle firmware reports the placeholder "Unknown" as the track title: it is a
// device artefact, not a track, so it must not reach the card.
export const cleanTitle = (value: string): string =>
  /^unknow?n?$/i.test(value.trim()) ? '' : value

// The same firmware answers `un_known` for a cover it does not have: relaying
// that string produces a broken image on every poll of a stopped player. The
// spelling varies by model (`unknown`, `unknow`, `un-known`), so match the stem.
export const artUri = (value: string): string => {
  const uri = value.trim()
  return /^(un[_-]?know?n?|-)$/i.test(uri) ? '' : uri
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
  new Promise(resolve => {
    const sender = scheme === 'https' ? httpsRequest : httpRequest
    const options = {
      host: ip,
      port: scheme === 'https' ? 443 : 80,
      // The equalizer commands carry a JSON argument (quotes, braces, spaces):
      // the device decodes the query string, and an unencoded path with those
      // characters is rejected by the HTTP client before it leaves the hub.
      path: `/httpapi.asp?command=${encodeURIComponent(command)}`,
      method: 'GET',
      timeout: timeoutMs,
      headers: { accept: 'application/json, text/plain, */*' },
      ...(scheme === 'https' ? { rejectUnauthorized: false } : {}),
    }
    const req = sender(options, res => {
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
  if (first !== null) {
    // Remember the transport that answered, including the default one: the
    // report names it, and a device that stops answering on its first scheme
    // is retried on the other one without waiting for a failure.
    transports.set(ip, preferred)
    return first
  }
  const fallback: Scheme = preferred === 'https' ? 'http' : 'https'
  const second = await getOnce(ip, command, fallback)
  if (second !== null) transports.set(ip, fallback)
  return second
}

// The scheme the device answered on, `null` before the first successful call:
// "the hub talks to this address over https" is part of a support report.
export const transportOf = (ip: string): Scheme | null => transports.get(ip) ?? null

type Binary = { body: Buffer; type: string }

// A cover is a few hundred kilobytes on every player seen so far; the cap is
// what keeps a misbehaving host from filling the process memory through the
// relay, not a claim about real artwork size.
const maxArtBytes = 6 * 1024 * 1024

const privateIpv4 = (address: string): boolean => {
  const [a, b] = address.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

const privateIpv6 = (address: string): boolean => {
  const value = address.toLowerCase()
  if (value === '::' || value === '::1') return true
  // An IPv4-mapped address reaches the same machine: the URL parser rewrites
  // `::ffff:192.168.1.10` to `::ffff:c0a8:10a`, so decode both spellings.
  const mapped = /^::ffff:(.+)$/.exec(value)
  if (mapped !== null) {
    const rest = mapped[1]
    if (rest.includes('.')) return privateIpv4(rest)
    const [high, low] = rest.split(':').map(group => Number.parseInt(group, 16))
    if (Number.isFinite(high) && Number.isFinite(low)) {
      return privateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff].join('.'))
    }
  }
  return /^(fc|fd|fe[89ab]|ff)/.test(value)
}

// Loopback, private, link-local, carrier NAT, multicast and reserved: none of
// those is a cover host. The speaker itself is the one allowed private target,
// and its address is the one the hub already polls.
const privateAddress = (address: string): boolean =>
  address.includes(':') ? privateIpv6(address) : privateIpv4(address)

// Resolve once and connect to the address that was checked: a name that answers
// a public address during the guard and a private one at connect time is the
// oldest trick against this kind of check.
const resolveAddresses = async (hostname: string): Promise<string[] | null> => {
  if (isIP(hostname) !== 0) return [hostname]
  try {
    const found = await lookup(hostname, { all: true, verbatim: true })
    return found.length === 0 ? null : found.map(entry => entry.address)
  } catch {
    return null
  }
}

// The bytes decide, not the header: a streaming host answers
// `application/octet-stream` for a JPEG more often than not, and a text or HTML
// body must never reach the browser as an image.
const sniffArtType = (body: Buffer): string | null => {
  if (body.length < 12) return null
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg'
  if (body.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
  if (
    body.subarray(0, 4).toString('latin1') === 'RIFF' &&
    body.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (
    body[0] === 0x89 &&
    body.subarray(1, 4).toString('latin1') === 'PNG' &&
    body[4] === 0x0d &&
    body[5] === 0x0a
  ) {
    return 'image/png'
  }
  return null
}

type BinaryOptions = { port?: number; insecure?: boolean; serverName?: string }

const getBinary = (
  ip: string,
  path: string,
  scheme: Scheme,
  { port, insecure = false, serverName }: BinaryOptions = {}
): Promise<Binary | null> =>
  new Promise(resolve => {
    const sender = scheme === 'https' ? httpsRequest : httpRequest
    const options = {
      host: ip,
      port: port ?? (scheme === 'https' ? 443 : 80),
      path,
      method: 'GET',
      timeout: 5000,
      // The connection goes to the address that was checked; the name the host
      // expects still decides the Host header and the certificate.
      headers:
        serverName === undefined ? { accept: 'image/*' } : { accept: 'image/*', host: serverName },
      ...(serverName === undefined ? {} : { servername: serverName }),
      ...(scheme === 'https' && insecure ? { rejectUnauthorized: false } : {}),
    }
    const req = sender(options, res => {
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
        const body = Buffer.concat(chunks)
        const type = sniffArtType(body)
        resolve(type === null ? null : { body, type })
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
    target = parsed.hostname.replace(/^\[|\]$/g, '')
    port = parsed.port === '' ? undefined : Number(parsed.port)
    path = `${parsed.pathname}${parsed.search}`
    scheme = parsed.protocol === 'http:' ? 'http' : 'https'
  } catch {
    if (!path.startsWith('/')) path = `/${path}`
  }
  // A self-signed certificate is expected on the speaker, never on a public
  // artwork host. A cover hosted by another machine on the local network is
  // refused: the speaker is the one private target the relay accepts.
  const addresses = await resolveAddresses(target)
  if (addresses === null) {
    console.warn(`wiim-hub: art refused, ${target} does not resolve`)
    return null
  }
  const onDevice = target === deviceIp || addresses.includes(deviceIp)
  if (!onDevice && addresses.some(entry => privateAddress(entry))) {
    console.warn(`wiim-hub: art refused, ${target} is not a public address`)
    return null
  }
  const address = onDevice
    ? deviceIp
    : (addresses.find(entry => entry.includes('.')) ?? addresses[0])
  // An address literal is its own Host header: naming it as a TLS server would
  // only trip the RFC 6066 warning.
  const serverName = onDevice || isIP(target) !== 0 ? undefined : target
  const options: BinaryOptions = {
    port,
    insecure: onDevice,
    ...(serverName === undefined ? {} : { serverName }),
  }
  const first = await getBinary(address, path, scheme, options)
  if (first !== null) return first
  return getBinary(address, path, scheme === 'https' ? 'http' : 'https', options)
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

// An external input carries a signal, not a track: the analogue and optical
// sources have no duration to seek in and no metadata to show. The firmware
// keeps answering the position of the last stream it played (`curpos` 25318,
// `totlen` 137000 measured on optical), which reads as a track that is not
// there, so the position is neutralised at the source and every view agrees.
// The transport state is left alone: the device does know whether the input is
// playing. Bluetooth stays out until it has been measured the same way.
export const isExternalInput = (input: string): boolean =>
  input === 'optical' || input === 'line-in'

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

type Capability = {
  at: number
  inputs: string[]
  inputLabels: Record<string, string>
  outputs: OutputOption[]
}

const capabilityTtlMs = 300_000
const capabilityCache = new Map<string, Capability>()

// Inputs come from two places: the physical list the model reports, then the
// inputs the user left enabled in the vendor app. A disabled input is kept
// when the device reports it as present, because the hardware did not vanish;
// only an input the user enabled but the capability list missed is added.
const pushMode = (list: string[], entry: unknown): void => {
  if (!isRecord(entry)) return
  const mode = text(entry.mode)
  if (mode !== '' && !list.includes(mode)) list.push(mode)
}

const pushEnabledMode = (list: string[], entry: unknown): void => {
  if (!isRecord(entry)) return
  const mode = text(entry.mode)
  if (mode !== '' && num(entry.enable) === 1 && !list.includes(mode)) list.push(mode)
}

const readInputs = (capabilityRaw: string | null, enableRaw: string | null): string[] => {
  const list: string[] = []
  const capability = parseJson(capabilityRaw)
  if (Array.isArray(capability?.audioInput)) {
    for (const entry of capability.audioInput) pushMode(list, entry)
  }
  const enable = parseJson(enableRaw)
  if (Array.isArray(enable?.audioInput)) {
    for (const entry of enable.audioInput) pushEnabledMode(list, entry)
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
    if (outputs.some(output => output.hardware === hardware)) continue
    outputs.push({ hardware, name })
  }
  return outputs
}

type CapabilityView = Omit<Capability, 'at'>

const emptyCapability = (): Capability => ({ at: 0, inputs: [], inputLabels: {}, outputs: [] })

// A pure seam: the four capability answers in, the merged view out, `null` when
// this model answered nothing the hub understands. The cache stamp and the
// fallback to what was already known stay in `capabilityFor`, which is what
// makes the awkward answers testable without a speaker.
export const parseCapability = (answers: {
  inputs: string | null
  enable: string | null
  rename: string | null
  outputs: string | null
}): CapabilityView | null => {
  const inputs = readInputs(answers.inputs, answers.enable)
  const outputs = readOutputs(answers.outputs)
  if (inputs.length === 0 && outputs.length === 0) return null
  return { inputs, inputLabels: readLabels(answers.rename), outputs }
}

// Probing a capability costs four requests and the answer almost never
// changes: cache it per address, and never let a failed probe erase what was
// already known.
const capabilityFor = async (ip: string): Promise<Capability> => {
  const cached = capabilityCache.get(ip)
  if (cached !== undefined && Date.now() - cached.at < capabilityTtlMs) return cached
  const [primaryRaw, enableRaw, renameRaw, outputRaw] = await Promise.all([
    fetchCommand(ip, 'getAudioInputCapbility'),
    fetchCommand(ip, 'getAudioInputEnable'),
    fetchCommand(ip, 'getModeRename'),
    fetchCommand(ip, 'getSoundCardModeSupportList'),
  ])
  // `getAudioInputCapbility` is the vendor's own spelling, typo included. A
  // model that only answers the corrected name would otherwise lose its whole
  // input list, so the miss costs one retry once per cache window.
  const capabilityRaw =
    parseJson(primaryRaw) === null ? await fetchCommand(ip, 'getAudioInputCapability') : primaryRaw
  const parsed = parseCapability({
    inputs: capabilityRaw,
    enable: enableRaw,
    rename: renameRaw,
    outputs: outputRaw,
  })
  if (parsed === null) return cached ?? emptyCapability()
  const value: Capability = { at: Date.now(), ...parsed }
  capabilityCache.set(ip, value)
  return value
}

const presetTtlMs = 60_000
const presetCache = new Map<string, { at: number; value: Preset[] }>()

// Same seam as `parseCapability`: an answer that is not a preset list (an
// `unknown command`, an empty body) returns `null` so the caller can keep what
// it already knew. A slot without a usable number is skipped, an absent name
// falls back to the number, and the list comes out ordered.
export const parsePresets = (raw: string | null): Preset[] | null => {
  const info = parseJson(raw)
  const entries = Array.isArray(info?.preset_list) ? info.preset_list : null
  if (entries === null) return null
  const value: Preset[] = []
  for (const entry of entries) {
    if (!isRecord(entry)) continue
    const number = num(entry.number)
    if (number === null || number <= 0) continue
    value.push({
      number,
      name: text(entry.name) || String(number),
      artwork: artUri(text(entry.picurl)),
    })
  }
  value.sort((left, right) => left.number - right.number)
  return value
}

const presetsFor = async (ip: string): Promise<Preset[]> => {
  const cached = presetCache.get(ip)
  if (cached !== undefined && Date.now() - cached.at < presetTtlMs) return cached.value
  const parsed = parsePresets(await fetchCommand(ip, 'getPresetInfo'))
  if (parsed === null) return cached?.value ?? []
  presetCache.set(ip, { at: Date.now(), value: parsed })
  return parsed
}

// The graphic EQ plugin the firmware exposes. Reading a curve takes this URI
// plus a source name; an empty source means "the one playing", and the answer
// names it, which is what a later band write must target.
export const eqPluginUri = 'http://moddevices.com/plugins/caps/Eq10HP'

export const eqQuery = `EQGetLV2SourceBandEx:${JSON.stringify({ EQLevel: 1, source_name: '', pluginURI: eqPluginUri })}`

type Acoustic = { at: number; presets: string[]; roomFit: boolean }
type AcousticView = Omit<Acoustic, 'at'>
const acousticCache = new Map<string, Acoustic>()

// Same seam: each field is kept when its own answer is unreadable, because a
// player without EQ answers `unknown command` and turning the panel off on one
// bad request is worse than showing what the last good probe knew.
export const parseAcoustic = (
  answers: { presets: string | null; capability: string | null },
  cached: AcousticView | null
): AcousticView => {
  const list = parseArray(answers.presets)
  const capability = parseJson(answers.capability)
  const presets =
    list === null
      ? (cached?.presets ?? [])
      : list.filter((name): name is string => typeof name === 'string' && name !== '')
  const roomFit = isRecord(capability?.RC) ? true : (cached?.roomFit ?? false)
  return { presets, roomFit }
}

// The factory curve names and the room-correction capability are static for a
// firmware: neither changes while a player is streaming, so both ride the same
// five minute cache as the input and output lists.
const acousticFor = async (ip: string): Promise<Acoustic> => {
  const cached = acousticCache.get(ip)
  if (cached !== undefined && Date.now() - cached.at < capabilityTtlMs) return cached
  const [listRaw, capabilityRaw] = await Promise.all([
    fetchCommand(ip, 'EQGetList'),
    fetchCommand(ip, 'GetAcousticCapability'),
  ])
  const value: Acoustic = {
    at: Date.now(),
    ...parseAcoustic({ presets: listRaw, capability: capabilityRaw }, cached ?? null),
  }
  acousticCache.set(ip, value)
  return value
}

const readEq = (raw: string | null, acoustic: Acoustic): Equalizer => {
  const parsed = parseJson(raw)
  const bands: EqBand[] = []
  if (Array.isArray(parsed?.EQBand)) {
    const entries = parsed.EQBand.filter(isRecord)
    entries.sort((left, right) => (num(left.index) ?? 0) - (num(right.index) ?? 0))
    for (const entry of entries) {
      const name = text(entry.param_name)
      if (name === '') continue
      const value =
        typeof entry.value === 'number' ? entry.value : Number.parseFloat(text(entry.value))
      if (!Number.isFinite(value)) continue
      bands.push({ name, value })
    }
  }
  return {
    enabled: text(parsed?.EQStat).toLowerCase() === 'on',
    name: text(parsed?.Name),
    source: text(parsed?.source_name),
    bands,
    presets: acoustic.presets,
    roomFit: acoustic.roomFit,
  }
}

// `getMetaInfo` reports the stream numbers as strings; they describe the codec
// in flight, not the device, so they reset to nothing when playback stops.
const readQuality = (metaData: Record<string, unknown>): Quality => ({
  sampleRate: num(metaData.sampleRate),
  bitDepth: num(metaData.bitDepth),
  bitRate: num(metaData.bitRate),
})

// The device settings a user may change. They are read on demand rather than
// on every poll: four extra requests every three seconds to display values
// nobody is looking at is a cost the speaker does not need.
export type DeviceSettings = {
  name: string
  ledOn: boolean | null
  buttonsOn: boolean | null
  balance: number | null
  maxVolume: number | null
  fade: boolean | null
}

// LED and button answers are a bare `0`/`1`; the fade answer is a JSON object.
// One reader for both, and `null` when the model does not know the setting.
const flagOf = (raw: string | null): boolean | null => {
  if (raw === null) return null
  const answer = raw.trim()
  const direct = Number.parseInt(answer, 10)
  if (Number.isFinite(direct)) return direct === 1
  const parsed = parseJson(answer)
  if (parsed === null) return null
  for (const value of Object.values(parsed)) {
    const flag = typeof value === 'number' ? value : Number.parseInt(text(value), 10)
    if (Number.isFinite(flag)) return flag === 1
  }
  return null
}

const floatOf = (raw: string | null): number | null => {
  if (raw === null) return null
  const parsed = Number.parseFloat(raw.trim())
  return Number.isFinite(parsed) ? parsed : null
}

export const readSettings = async (ip: string): Promise<DeviceSettings | null> => {
  const [statusRaw, ledRaw, buttonRaw, balanceRaw, fadeRaw] = await Promise.all([
    fetchCommand(ip, 'getStatusEx'),
    fetchCommand(ip, 'LED_SWITCH_GET'),
    fetchCommand(ip, 'Button_Enable_GET'),
    fetchCommand(ip, 'getChannelBalance'),
    fetchCommand(ip, 'GetFadeFeature'),
  ])
  const status = parseJson(statusRaw)
  if (status === null) return null
  return {
    name: text(status.DeviceName),
    ledOn: flagOf(ledRaw),
    buttonsOn: flagOf(buttonRaw),
    balance: floatOf(balanceRaw),
    maxVolume: num(status.max_volume),
    fade: flagOf(fadeRaw),
  }
}

// The uuid is what the app joins a group with, so a member that lost its name
// is still worth listing.
const readMember = (entry: Record<string, unknown>): GroupMember | null => {
  const name = text(entry.name) || text(entry.Name)
  const uuid = text(entry.uuid) || text(entry.Uuid)
  const ip = text(entry.ip) || text(entry.Ip)
  if (name === '' && uuid === '') return null
  return { name: name === '' ? uuid : name, ip, uuid }
}

// The documented payload spells every key with a capital (`Slave_list`,
// `Slaves`); this firmware answers `slavelist` and `slaves`. Both are read and
// neither is assumed to be there.
const readMembers = (value: unknown): GroupMember[] => {
  if (!Array.isArray(value)) return []
  const members: GroupMember[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const member = readMember(entry)
    if (member !== null) members.push(member)
  }
  return members
}

type SavedGroup = { id: string; name: string; members: GroupMember[] }
type Registry = { at: number; groups: SavedGroup[]; current: string }
type RegistryView = Omit<Registry, 'at'>

const emptyRegistry = (): Registry => ({ at: 0, groups: [], current: '' })

// Same seam again: an answer the hub cannot read returns `null` rather than an
// empty registry, so a failed probe does not make the saved group vanish from
// the panel for a minute. A readable answer with no group is a real "nothing
// saved" and clears the view.
export const parseRegistry = (raw: string | null): RegistryView | null => {
  const parsed = parseJson(raw)
  if (parsed === null) return null
  const groups: SavedGroup[] = []
  if (Array.isArray(parsed.grouplist)) {
    for (const entry of parsed.grouplist) {
      if (!isRecord(entry)) continue
      const id = text(entry.group_id)
      if (id === '') continue
      groups.push({ id, name: text(entry.group_name), members: readMembers(entry.slavelist) })
    }
  }
  // `current_group_id` is kept by a player that drives no group at all here, so
  // a non-empty value means "the app points at that group", not "it is running".
  return { groups, current: text(parsed.current_group_id) }
}

const groupTtlMs = 60_000
const groupCache = new Map<string, Registry>()

// The registry is what the vendor app remembers: groups survive a reboot, a
// running group does not. Someone edits a group rarely enough for the same
// minute-long cache the presets use.
const groupsFor = async (ip: string): Promise<Registry> => {
  const cached = groupCache.get(ip)
  if (cached !== undefined && Date.now() - cached.at < groupTtlMs) return cached
  const parsed = parseRegistry(await fetchCommand(ip, 'multiroom:getnamegrouplist'))
  const value: Registry =
    parsed === null ? (cached ?? emptyRegistry()) : { at: Date.now(), ...parsed }
  groupCache.set(ip, value)
  return value
}

// A member is the role the device claims, nothing inferred: a reported member
// list makes it a master, a group id in its status makes it a follower, and a
// saved group with nothing running stays a saved group rather than a fake
// offline member.
const groupRole = (drives: boolean, follows: boolean): GroupState['role'] => {
  if (drives) return 'master'
  return follows ? 'member' : 'none'
}

export const parseGroup = (
  raw: Record<string, unknown> | null,
  statusGroup: string,
  registry: Registry
): GroupState => {
  const reported = readMembers(raw?.Slave_list ?? raw?.slavelist ?? raw?.slave_list)
  const count = num(raw?.Slaves) ?? num(raw?.slaves) ?? reported.length
  const follows = statusGroup !== '' && statusGroup !== '0'
  const role = groupRole(count > 0 || reported.length > 0, follows)
  const saved = registry.groups.find(entry => entry.id === registry.current) ?? null
  return {
    role,
    name: saved?.name ?? '',
    members: role === 'none' ? (saved?.members ?? []) : reported,
    saved: saved !== null,
  }
}

// A pure seam, like `parseDiagnostics`: the answers and the caches already
// resolved, one `DevicePatch` out. `pollDevice` only owns the transport and the
// cache policy, which is what makes the awkward payload shapes testable without
// a speaker (see `server/device.test.ts`).
export const parseDevice = (input: {
  host: string
  ip: string
  status: Record<string, unknown> | null
  player: Record<string, unknown> | null
  meta: Record<string, unknown> | null
  output: Record<string, unknown> | null
  sleepRaw: string | null
  eqRaw: string | null
  slaves: Record<string, unknown> | null
  registry: Registry
  capability: Capability
  presets: Preset[]
  acoustic: Acoustic
}): DevicePatch => {
  const {
    host,
    ip,
    status,
    player,
    meta,
    output,
    sleepRaw,
    eqRaw,
    slaves,
    registry,
    capability,
    presets,
    acoustic,
  } = input
  const metaData = meta && isRecord(meta.metaData) ? meta.metaData : {}
  const inputId = inputFromMode(text(player?.mode))
  const external = isExternalInput(inputId)
  return {
    ip,
    online: status !== null,
    name: text(status?.DeviceName) || host,
    model: cleanModel(text(status?.model) || text(status?.project)),
    firmware: text(status?.firmware),
    release: text(status?.Release),
    ssid: maybeHex(text(status?.essid)),
    bssid: text(status?.BSSID),
    wmrmVersion: text(status?.wmrm_version),
    group: parseGroup(slaves, text(status?.group), registry),
    rssi: readRssi(status),
    volume: num(player?.vol),
    status: text(player?.status),
    title: cleanTitle(text(metaData.title) || maybeHex(text(player?.Title))),
    artist: cleanTitle(text(metaData.artist) || maybeHex(text(player?.Artist))),
    album: cleanTitle(text(metaData.album) || maybeHex(text(player?.Album))),
    albumArt: artUri(text(metaData.albumArtURI)),
    curposMs: external ? null : num(player?.curpos),
    totalMs: external ? null : num(player?.totlen),
    source: text(player?.vendor),
    mode: text(player?.mode),
    input: inputId,
    maxVolume: num(status?.max_volume),
    mute: num(player?.mute) === 1,
    sleepSeconds: num(sleepRaw),
    inputs: capability.inputs,
    inputLabels: capability.inputLabels,
    outputs: capability.outputs,
    outputHardware: num(output?.hardware),
    presets,
    eq: readEq(eqRaw, acoustic),
    quality: readQuality(metaData),
    link: {
      snr: num(status?.wlanSnr),
      noise: num(status?.wlanNoise),
      freqMhz: num(status?.wlanFreq),
      rateMbps: num(status?.wlanDataRate),
    },
  }
}

// `host` is either an address or a resolvable name (`kitchen.local`), so the
// caller never has to care which one the configuration carries.
export const pollDevice = async (host: string): Promise<DevicePatch> => {
  const ip = resolveTarget(host)
  const [statusRaw, playerRaw, metaRaw, outputRaw, sleepRaw, eqRaw] = await Promise.all([
    fetchCommand(ip, 'getStatusEx'),
    fetchCommand(ip, 'getPlayerStatusEx'),
    fetchCommand(ip, 'getMetaInfo'),
    fetchCommand(ip, 'getNewAudioOutputHardwareMode'),
    fetchCommand(ip, 'getShutdown'),
    fetchCommand(ip, eqQuery),
  ])
  const status = parseJson(statusRaw)
  const online = status !== null
  if (!online) forgetTarget(host)
  const groupId = text(status?.group)
  const registry = online
    ? await groupsFor(ip)
    : (groupCache.get(ip) ?? { at: 0, groups: [], current: '' })
  // The slave list is the only call that tells membership, so it costs one more
  // request when the player is grouped or when the registry points at a saved
  // group; a player with no group at all never pays for it.
  const grouped = (groupId !== '' && groupId !== '0') || registry.current !== ''
  const slaves = grouped ? parseJson(await fetchCommand(ip, 'multiroom:getSlaveList')) : null
  const capability = online
    ? await capabilityFor(ip)
    : (capabilityCache.get(ip) ?? emptyCapability())
  const presets = online ? await presetsFor(ip) : (presetCache.get(ip)?.value ?? [])
  const acoustic = online
    ? await acousticFor(ip)
    : (acousticCache.get(ip) ?? { at: 0, presets: [], roomFit: false })
  return parseDevice({
    host,
    ip,
    status,
    player: parseJson(playerRaw),
    meta: parseJson(metaRaw),
    output: parseJson(outputRaw),
    sleepRaw,
    eqRaw,
    slaves,
    registry,
    capability,
    presets,
    acoustic,
  })
}

// The probes are three separate commands and each answer is optional: a build
// that lacks one of them still yields the other two, so a finding is only ever
// dropped when its own source is silent.
// A pure seam: the three answers in, one `Diagnostics` out. `readDiagnostics`
// only adds the transport, which is what makes the payload shapes testable
// without a speaker.
export const parseDiagnostics = (
  raw: { health: string | null; debug: string | null; hardware: string | null },
  now = Date.now()
): Diagnostics | null => {
  const health = parseJson(raw.health)
  const debug = parseJson(raw.debug)
  const hardware = parseJson(raw.hardware)
  if (health === null && debug === null && hardware === null) return null
  const soundCard = isRecord(hardware?.soundCardHwError) ? hardware.soundCardHwError : null
  const lost = [0, 1, 2, 3].map(index => num(debug?.[`upnp_action_lost${index}`]))
  const total = [0, 1, 2, 3].map(index => num(debug?.[`upnp_action_total${index}`]))
  const sum = (values: Array<number | null>): number | null => {
    const known = values.filter((value): value is number => value !== null)
    return known.length === 0 ? null : known.reduce((acc, value) => acc + value, 0)
  }
  return {
    at: now,
    health:
      health === null
        ? null
        : {
            disconnected: num(health.disconnectedCount),
            ethDisconnected: num(health.ethDisconnectedCount),
            pingFailures: num(health.pingCheckFailedCount),
            abnormalReboots: num(health.wlanAbnormalRebootTimes),
            roaming: num(health.wlanRoamingOn) === 1,
            band: num(health.wlanBand),
            lastMessage: text(health.lastDisconnectedMsg).trim(),
            lastMinutes: num(health.lastDisconnectedTime),
          },
    debug:
      debug === null
        ? null
        : {
            uptimeTicks: num(debug.power_ticks),
            crashes: {
              controller: num(debug.a01controller_crash),
              asrTts: num(debug.asr_tts_crash),
              mcu: num(debug.mcu_crash),
              deadlock: num(debug.process_deadlock),
            },
            upnpActionsLost: sum(lost),
            upnpActionsTotal: sum(total),
          },
    hardware:
      hardware === null
        ? null
        : {
            ethError: num(hardware.ethError) === 1,
            mfiError: num(hardware.mfiChipError) === 1,
            flashSpaceError: num(hardware.flashSpaceError) === 1,
            soundCardError:
              soundCard === null ? false : Object.values(soundCard).some(value => num(value) === 1),
            badBlocks: num(hardware.badBlockNum),
            totalBlocks: num(hardware.totalBlockNum),
          },
  }
}

export const readDiagnostics = async (host: string): Promise<Diagnostics | null> => {
  const ip = resolveTarget(host)
  const [health, debug, hardware] = await Promise.all([
    fetchCommand(ip, 'getNetworkHealth'),
    fetchCommand(ip, 'getDebugInfo'),
    fetchCommand(ip, 'getHwErrorInfo'),
  ])
  return parseDiagnostics({ health, debug, hardware })
}
