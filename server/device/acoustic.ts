import { isRecord, num, parseArray, parseJson, text } from './payload.ts'
import { probeCommand, slowProbeTtlMs } from './probes.ts'

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

// The graphic EQ plugin the firmware exposes. Reading a curve takes this URI
// plus a source name; an empty source means "the one playing", and the answer
// names it, which is what a later band write must target.
//
// The plain `http` scheme is part of the identifier the firmware matches, not a
// URL the hub ever fetches: nothing connects to it, which is why the insecure
// protocol rule does not apply.
export const eqPluginUri = 'http://moddevices.com/plugins/caps/Eq10HP' // NOSONAR

export const eqQuery = `EQGetLV2SourceBandEx:${JSON.stringify({ EQLevel: 1, source_name: '', pluginURI: eqPluginUri })}`

// Shared with `index.ts`, which hands the cached value to `parseDevice`.
export type Acoustic = { at: number; presets: string[]; roomFit: boolean }
export type AcousticView = Omit<Acoustic, 'at'>
export const acousticCache = new Map<string, Acoustic>()

export const emptyAcoustic = (): Acoustic => ({ at: 0, presets: [], roomFit: false })

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
export const acousticFor = async (ip: string, firmware: string): Promise<Acoustic> => {
  const cached = acousticCache.get(ip)
  if (cached !== undefined && Date.now() - cached.at < slowProbeTtlMs) return cached
  const [listRaw, capabilityRaw] = await Promise.all([
    probeCommand(ip, firmware, 'EQGetList'),
    probeCommand(ip, firmware, 'GetAcousticCapability'),
  ])
  const value: Acoustic = {
    at: Date.now(),
    ...parseAcoustic({ presets: listRaw, capability: capabilityRaw }, cached ?? null),
  }
  acousticCache.set(ip, value)
  return value
}

export const readEq = (raw: string | null, acoustic: Acoustic): Equalizer => {
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
