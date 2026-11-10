import type { EventStatus } from '../upnp.ts'
import {
  type Acoustic,
  acousticCache,
  acousticFor,
  type Equalizer,
  emptyAcoustic,
  eqQuery,
  readEq,
} from './acoustic.ts'
import type { Diagnostics } from './diagnostics.ts'
import { type Capability, capabilityCache, capabilityFor, emptyCapability } from './inputs.ts'
import type { GroupParent, GroupState, Registry } from './multiroom.ts'
import { emptyRegistry, groupCache, groupsFor, parseGroup } from './multiroom.ts'
import type { OutputOption } from './outputs.ts'
import { artUri, cleanTitle, isRecord, maybeHex, num, parseJson, text } from './payload.ts'
import { type Preset, presetCache, presetsFor } from './presets.ts'
import { probeCommand } from './probes.ts'
import { forgetTarget, resolveTarget } from './resolve.ts'
import {
  cleanModel,
  type DeviceEvent,
  inputFromMode,
  isExternalInput,
  type LinkMetrics,
  positionMs,
  type Quality,
  readQuality,
  readRssi,
  type Sample,
} from './status.ts'
import { fetchCommand } from './transport.ts'

// The aggregate: what one poll produces (`DevicePatch`), what the hub keeps of
// a device over time (`DeviceState`), and the two entry points that tie the
// areas together. Everything else lives in the module that owns its area, and
// callers import that module directly: a barrel over sixteen files hides which
// one a symbol comes from without buying anything.
export type DeviceState = DevicePatch & {
  updatedAt: number | null
  online: boolean
  lastSeen: number | null
  errors: number
  // What a member of a running group actually plays. A member answers
  // `mode 99, stop` and no track of its own: the stream runs on the speaker that
  // drives the group. The fleet pass copies what that speaker reports, so a
  // member card can show something audible, with the master named. Null when
  // the device plays on its own or no master is in the fleet.
  mirror: PlaybackMirror | null
  // The UPnP subscription behind the playback fields: `subscribed` means the
  // device pushes volume, mute and transport changes, `degraded` means a poll
  // contradicted it and the hub is back on the fast poll.
  upnp: EventStatus
  diagnostics: Diagnostics | null
  samples: Sample[]
  events: DeviceEvent[]
}

export type PlaybackMirror = {
  // The speaker the playback was read from, named for the reader.
  from: GroupParent
  group: string
  status: string
  title: string
  artist: string
  album: string
  albumArt: string
  curposMs: number | null
  totalMs: number | null
  source: string
  // The master's own poll time, so the progress of a mirror keeps advancing
  // between two polls instead of freezing on the last reading.
  updatedAt: number | null
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

// A pure seam, like `parseDiagnostics`: the answers and the caches already
// resolved, one `DevicePatch` out. `pollDevice` only owns the transport and the
// cache policy, which is what makes the awkward payload shapes testable without
// a speaker (see `server/device/index.test.ts`).
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
    curposMs: external ? null : positionMs(num(player?.curpos), inputId),
    totalMs: external ? null : positionMs(num(player?.totlen), inputId),
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
  // The build string is the second half of every probe key: a firmware update
  // changes it, so the capabilities are asked again instead of staying on what
  // the previous build answered.
  const firmware = text(status?.firmware)
  const groupId = text(status?.group)
  const registry = online ? await groupsFor(ip, firmware) : (groupCache.get(ip) ?? emptyRegistry())
  // The slave list is the only call that tells membership, so it costs one more
  // request when the player is grouped or when the registry points at a saved
  // group; a player with no group at all never pays for it.
  const grouped = (groupId !== '' && groupId !== '0') || registry.current !== ''
  const slaves = grouped
    ? parseJson(await probeCommand(ip, firmware, 'multiroom:getSlaveList'))
    : null
  const capability = online
    ? await capabilityFor(ip, firmware)
    : (capabilityCache.get(ip) ?? emptyCapability())
  const presets = online ? await presetsFor(ip, firmware) : (presetCache.get(ip)?.value ?? [])
  const acoustic = online
    ? await acousticFor(ip, firmware)
    : (acousticCache.get(ip) ?? emptyAcoustic())
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
