import type { DeviceState } from './device.ts'

// Every write the hub accepts, as a value. The browser never sends a device
// command: it sends an intent, the server checks it against the state it has
// (volume ceiling, available inputs and outputs) and only then builds the
// command. An unknown action is a bug, not a passthrough.
export type Action =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'toggle' }
  | { action: 'stop' }
  | { action: 'next' }
  | { action: 'prev' }
  | { action: 'seek'; seconds: number }
  | { action: 'volume'; level: number }
  | { action: 'mute'; muted: boolean }
  | { action: 'source'; input: string }
  | { action: 'preset'; slot: number }
  | { action: 'sleep'; seconds: number }
  | { action: 'output'; hardware: number }
  | { action: 'eq'; enabled: boolean }
  | { action: 'eqPreset'; name: string }
  | { action: 'eqBand'; band: string; value: number }

// The ten bands of the graphic equalizer, in the order the device reports
// them. Only these names are writable: the payload is a name the firmware
// matches against its own curve.
export const eqBandNames = [
  'band31hz',
  'band63hz',
  'band125hz',
  'band250hz',
  'band500hz',
  'band1khz',
  'band2khz',
  'band4khz',
  'band8khz',
  'band16khz',
] as const

// Measured on the Pro: a band accepts -12..+12 dB. Outside that the firmware
// answers Failed or clamps, so the hub refuses rather than guessing.
const eqGainLimit = 12

const fixed = {
  play: 'setPlayerCmd:resume',
  pause: 'setPlayerCmd:pause',
  toggle: 'setPlayerCmd:onepause',
  stop: 'setPlayerCmd:stop',
  next: 'setPlayerCmd:next',
  prev: 'setPlayerCmd:prev',
} as const

export type Parsed = { action: Action } | { error: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const integer = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return Number.isFinite(value) ? value : null
}

// The body is untrusted JSON: parse it into one of the known actions, with the
// numeric fields already checked as integers. Ranges that depend on the device
// are checked later, in `commandFor`, where the state is known.
export const parseAction = (body: unknown): Parsed => {
  if (!isRecord(body)) return { error: 'body must be an object' }
  const name = body.action
  if (typeof name !== 'string') return { error: 'missing action' }
  if (name in fixed) return { action: { action: name as keyof typeof fixed } }
  if (name === 'seek') {
    const seconds = integer(body.seconds)
    if (seconds === null || seconds < 0 || seconds > 86_400) return { error: 'invalid seek position' }
    return { action: { action: 'seek', seconds } }
  }
  if (name === 'volume') {
    const level = integer(body.level)
    if (level === null || level < 0 || level > 100) return { error: 'invalid volume level' }
    return { action: { action: 'volume', level } }
  }
  if (name === 'mute') {
    if (typeof body.muted !== 'boolean') return { error: 'invalid mute flag' }
    return { action: { action: 'mute', muted: body.muted } }
  }
  if (name === 'source') {
    if (typeof body.input !== 'string' || body.input.length === 0) return { error: 'invalid input' }
    return { action: { action: 'source', input: body.input } }
  }
  if (name === 'preset') {
    const slot = integer(body.slot)
    if (slot === null || slot < 1 || slot > 40) return { error: 'invalid preset slot' }
    return { action: { action: 'preset', slot } }
  }
  if (name === 'sleep') {
    const seconds = integer(body.seconds)
    if (seconds === null || seconds < 0 || seconds > 86_400) return { error: 'invalid sleep timer' }
    return { action: { action: 'sleep', seconds } }
  }
  if (name === 'output') {
    const hardware = integer(body.hardware)
    if (hardware === null || hardware < 1 || hardware > 99) return { error: 'invalid output mode' }
    return { action: { action: 'output', hardware } }
  }
  if (name === 'eq') {
    if (typeof body.enabled !== 'boolean') return { error: 'invalid eq flag' }
    return { action: { action: 'eq', enabled: body.enabled } }
  }
  if (name === 'eqPreset') {
    if (typeof body.name !== 'string' || body.name === '' || body.name.length > 40) {
      return { error: 'invalid eq preset' }
    }
    return { action: { action: 'eqPreset', name: body.name } }
  }
  if (name === 'eqBand') {
    if (typeof body.band !== 'string' || !eqBandNames.includes(body.band as (typeof eqBandNames)[number])) {
      return { error: 'invalid eq band' }
    }
    if (typeof body.value !== 'number' || !Number.isFinite(body.value)) return { error: 'invalid eq gain' }
    if (Math.abs(body.value) > eqGainLimit) return { error: `eq gain outside -${eqGainLimit}..${eqGainLimit} dB` }
    return { action: { action: 'eqBand', band: body.band, value: body.value } }
  }
  return { error: `unknown action ${name}` }
}

export type Command = { command: string; family: string | null }

// `family` marks the writes that a drag can repeat (volume, seek): the writer
// keeps only the last one pending, so a slider sends its final value instead of
// forty intermediate ones. Everything else is queued in order.
export const commandFor = (action: Action, device: DeviceState): Command | { error: string } => {
  switch (action.action) {
    case 'play':
    case 'pause':
    case 'toggle':
    case 'stop':
    case 'next':
    case 'prev':
      return { command: fixed[action.action], family: null }
    case 'seek':
      return { command: `setPlayerCmd:seek:${action.seconds}`, family: 'seek' }
    case 'volume': {
      const ceiling = device.maxVolume ?? 100
      if (action.level > ceiling) return { error: `volume above the device ceiling (${ceiling})` }
      return { command: `setPlayerCmd:vol:${action.level}`, family: 'volume' }
    }
    case 'mute':
      return { command: `setPlayerCmd:mute:${action.muted ? 1 : 0}`, family: null }
    case 'source':
      if (!device.inputs.includes(action.input)) return { error: `input not available: ${action.input}` }
      return { command: `setPlayerCmd:switchmode:${action.input}`, family: null }
    case 'preset':
      return { command: `MCUKeyShortClick:${action.slot}`, family: null }
    case 'sleep':
      return { command: `setShutdown:${action.seconds}`, family: null }
    case 'output':
      if (!device.outputs.some((output) => output.hardware === action.hardware)) {
        return { error: `output not available: ${action.hardware}` }
      }
      return { command: `setAudioOutputHardwareMode:${action.hardware}`, family: null }
    case 'eq':
      return { command: action.enabled ? 'EQOn' : 'EQOff', family: null }
    case 'eqPreset':
      // The list comes from the device itself, so a name outside it either
      // does not exist on this firmware or was not meant as a preset.
      if (!device.eq.presets.includes(action.name)) return { error: `unknown eq preset: ${action.name}` }
      return { command: `EQLoad:${action.name}`, family: null }
    case 'eqBand': {
      // The curve is stored per source: writing without the source the device
      // reported would edit another room's curve.
      if (device.eq.source === '') return { error: 'eq source unknown' }
      const payload = {
        source_name: device.eq.source,
        pluginURI: 'http://moddevices.com/plugins/caps/Eq10HP',
        channelMode: 'Stereo',
        EQBand: [{ param_name: action.band, value: Math.round(action.value * 10) / 10 }],
      }
      return { command: `EQSetLV2SourceBand:${JSON.stringify(payload)}`, family: 'eq-band' }
    }
    default:
      return { error: 'unsupported action' }
  }
}

// A device answers `OK` to a write, or an error token. `unknown command` is a
// capability answer, not a transient failure: the UI shows it as unsupported.
export const commandOutcome = (body: string | null): { ok: boolean; unsupported: boolean } => {
  if (body === null) return { ok: false, unsupported: false }
  const answer = body.trim()
  if (/^unknown command$/i.test(answer)) return { ok: false, unsupported: true }
  if (/^failed$/i.test(answer)) return { ok: false, unsupported: false }
  if (/"status"\s*:\s*"Failed"/i.test(answer)) return { ok: false, unsupported: false }
  return { ok: true, unsupported: false }
}
