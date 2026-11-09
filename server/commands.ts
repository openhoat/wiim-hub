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
  | { action: 'rename'; name: string }
  | { action: 'led'; on: boolean }
  | { action: 'buttons'; on: boolean }
  | { action: 'balance'; value: number }
  | { action: 'maxVolume'; level: number }
  | { action: 'fade'; on: boolean }
  | { action: 'url'; url: string }

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

// These carry no field, so their name alone is the whole body.
type FixedName = keyof typeof fixed
const isFixedName = (name: string): name is FixedName => Object.hasOwn(fixed, name)

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
//
// The accepted vocabulary is a table, not a ladder of `if`s: every action that
// carries a field is one small parser, so adding a write means adding a row and
// reading a row tells you exactly what that write accepts.
type Fields = Record<string, unknown>
type Parser = (fields: Fields) => Parsed

const accept = (action: Action): Parsed => ({ action })
const refuse = (error: string): Parsed => ({ error })

const flagField = (fields: Fields, key: string): boolean | null => {
  const value = fields[key]
  return typeof value === 'boolean' ? value : null
}

// Every numeric field here is an integer inside an inclusive range.
const rangedField = (fields: Fields, key: string, min: number, max: number): number | null => {
  const value = integer(fields[key])
  return value !== null && value >= min && value <= max ? value : null
}

const decimalField = (fields: Fields, key: string): number | null => {
  const value = fields[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const nonEmptyTextField = (fields: Fields, key: string): string | null => {
  const value = fields[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const textField = (fields: Fields, key: string, maxLength: number): string | null => {
  const value = nonEmptyTextField(fields, key)
  return value !== null && value.length <= maxLength ? value : null
}

const eqBandSet: ReadonlySet<string> = new Set(eqBandNames)

const isEqBand = (value: string): value is (typeof eqBandNames)[number] => eqBandSet.has(value)

const asUrl = (value: string): URL | null => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

// No one seeks or sleeps longer than a day, and the player refuses a longer
// address than this.
const maxSeconds = 86_400
const maxUrlLength = 2048

const flagAction =
  (action: 'led' | 'buttons' | 'fade'): Parser =>
  fields => {
    const on = flagField(fields, 'on')
    return on === null ? refuse(`invalid ${action} flag`) : accept({ action, on })
  }

const renameParser: Parser = fields => {
  const raw = fields.name
  if (typeof raw !== 'string') return refuse('invalid device name')
  // The name travels in a command line the device parses: keep it to printable
  // characters and a length the firmware accepts.
  const name = raw.trim()
  if (name.length === 0 || name.length > 32) return refuse('invalid device name')
  if (/[^\p{L}\p{N}\p{P}\p{Zs}]/u.test(name)) return refuse('invalid device name')
  return accept({ action: 'rename', name })
}

const eqBandParser: Parser = fields => {
  const band = fields.band
  if (typeof band !== 'string' || !isEqBand(band)) return refuse('invalid eq band')
  const value = decimalField(fields, 'value')
  if (value === null) return refuse('invalid eq gain')
  if (Math.abs(value) > eqGainLimit) {
    return refuse(`eq gain outside -${eqGainLimit}..${eqGainLimit} dB`)
  }
  return accept({ action: 'eqBand', band, value })
}

const urlParser: Parser = fields => {
  const raw = fields.url
  if (typeof raw !== 'string') return refuse('invalid stream url')
  const value = raw.trim()
  if (value === '' || value.length > maxUrlLength) return refuse('invalid stream url')
  const parsed = asUrl(value)
  if (parsed === null) return refuse('invalid stream url')
  // The speaker fetches the address itself: a local file path or a javascript
  // scheme is not a stream, and anything else is not worth guessing.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return refuse('stream url must be http or https')
  }
  return accept({ action: 'url', url: parsed.toString() })
}

const balanceParser: Parser = fields => {
  const value = decimalField(fields, 'value')
  if (value === null) return refuse('invalid balance')
  // Measured: +/-1 is accepted, +/-2 is Failed. Clamp is a refusal, not a fix.
  return Math.abs(value) > 1
    ? refuse('balance outside -1..1')
    : accept({ action: 'balance', value })
}

const parsers: Record<string, Parser> = {
  seek: fields => {
    const seconds = rangedField(fields, 'seconds', 0, maxSeconds)
    return seconds === null ? refuse('invalid seek position') : accept({ action: 'seek', seconds })
  },
  volume: fields => {
    const level = rangedField(fields, 'level', 0, 100)
    return level === null ? refuse('invalid volume level') : accept({ action: 'volume', level })
  },
  mute: fields => {
    const muted = flagField(fields, 'muted')
    return muted === null ? refuse('invalid mute flag') : accept({ action: 'mute', muted })
  },
  source: fields => {
    const input = nonEmptyTextField(fields, 'input')
    return input === null ? refuse('invalid input') : accept({ action: 'source', input })
  },
  preset: fields => {
    const slot = rangedField(fields, 'slot', 1, 40)
    return slot === null ? refuse('invalid preset slot') : accept({ action: 'preset', slot })
  },
  sleep: fields => {
    const seconds = rangedField(fields, 'seconds', 0, maxSeconds)
    return seconds === null ? refuse('invalid sleep timer') : accept({ action: 'sleep', seconds })
  },
  output: fields => {
    const hardware = rangedField(fields, 'hardware', 1, 99)
    return hardware === null
      ? refuse('invalid output mode')
      : accept({ action: 'output', hardware })
  },
  eq: fields => {
    const enabled = flagField(fields, 'enabled')
    return enabled === null ? refuse('invalid eq flag') : accept({ action: 'eq', enabled })
  },
  eqPreset: fields => {
    const name = textField(fields, 'name', 40)
    return name === null ? refuse('invalid eq preset') : accept({ action: 'eqPreset', name })
  },
  eqBand: eqBandParser,
  rename: renameParser,
  led: flagAction('led'),
  buttons: flagAction('buttons'),
  fade: flagAction('fade'),
  balance: balanceParser,
  maxVolume: fields => {
    const level = rangedField(fields, 'level', 1, 100)
    return level === null
      ? refuse('invalid maximum volume')
      : accept({ action: 'maxVolume', level })
  },
  url: urlParser,
}

// `Object.hasOwn` rather than `in`: a name such as `toString` reaches this table
// from untrusted JSON, and the prototype is not a write the hub accepts.
export const parseAction = (body: unknown): Parsed => {
  if (!isRecord(body)) return refuse('body must be an object')
  const name = body.action
  if (typeof name !== 'string') return refuse('missing action')
  if (isFixedName(name)) return accept({ action: name })
  const parser = Object.hasOwn(parsers, name) ? parsers[name] : null
  if (parser === null) return refuse(`unknown action ${name}`)
  return parser(body)
}

export type Command = { command: string; family: string | null }

// A write either produces a command or a refusal that names the value it would
// not accept.
type Outcome = Command | { error: string }

// `family` marks the writes that a drag can repeat (volume, seek): the writer
// keeps only the last one pending, so a slider sends its final value instead of
// forty intermediate ones. Everything else is queued in order.
const volumeCommand = (
  action: Extract<Action, { action: 'volume' }>,
  device: DeviceState
): Outcome => {
  const ceiling = device.maxVolume ?? 100
  if (action.level > ceiling) return { error: `volume above the device ceiling (${ceiling})` }
  return { command: `setPlayerCmd:vol:${action.level}`, family: 'volume' }
}

const sourceCommand = (
  action: Extract<Action, { action: 'source' }>,
  device: DeviceState
): Outcome => {
  if (!device.inputs.includes(action.input))
    return { error: `input not available: ${action.input}` }
  return { command: `setPlayerCmd:switchmode:${action.input}`, family: null }
}

const outputCommand = (
  action: Extract<Action, { action: 'output' }>,
  device: DeviceState
): Outcome => {
  if (!device.outputs.some(output => output.hardware === action.hardware)) {
    return { error: `output not available: ${action.hardware}` }
  }
  return { command: `setAudioOutputHardwareMode:${action.hardware}`, family: null }
}

const eqPresetCommand = (
  action: Extract<Action, { action: 'eqPreset' }>,
  device: DeviceState
): Outcome => {
  // The list comes from the device itself, so a name outside it either does not
  // exist on this firmware or was not meant as a preset.
  if (!device.eq.presets.includes(action.name))
    return { error: `unknown eq preset: ${action.name}` }
  return { command: `EQLoad:${action.name}`, family: null }
}

const eqBandCommand = (
  action: Extract<Action, { action: 'eqBand' }>,
  device: DeviceState
): Outcome => {
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

// The three switches that all read `<name>:<0|1>`, by command name.
const flagCommands: Record<'led' | 'buttons' | 'fade', string> = {
  led: 'LED_SWITCH_SET',
  buttons: 'Button_Enable_SET',
  fade: 'SetFadeFeature',
}

// Every write the device state cannot refuse: the command is built from the
// value the browser sent, and the only decision left is whether a drag may
// collapse it (the `family`).
const statelessCommand = (
  action: Exclude<
    Action,
    Extract<Action, { action: 'volume' | 'source' | 'output' | 'eqPreset' | 'eqBand' }>
  >
): Outcome => {
  if (isFixedName(action.action)) return { command: fixed[action.action], family: null }
  switch (action.action) {
    case 'seek':
      return { command: `setPlayerCmd:seek:${action.seconds}`, family: 'seek' }
    case 'mute':
      return { command: `setPlayerCmd:mute:${action.muted ? 1 : 0}`, family: null }
    case 'preset':
      return { command: `MCUKeyShortClick:${action.slot}`, family: null }
    case 'sleep':
      return { command: `setShutdown:${action.seconds}`, family: null }
    case 'eq':
      return { command: action.enabled ? 'EQOn' : 'EQOff', family: null }
    case 'rename':
      return { command: `setDeviceName:${action.name}`, family: null }
    case 'led':
    case 'buttons':
    case 'fade':
      return { command: `${flagCommands[action.action]}:${action.on ? 1 : 0}`, family: null }
    case 'balance':
      // The device takes a decimal: round to the tenth, which is finer than the
      // half step the UI offers and still inside the measured range.
      return {
        command: `setChannelBalance:${Math.round(action.value * 10) / 10}`,
        family: 'balance',
      }
    case 'maxVolume':
      return { command: `setMaxVolume:${action.level}`, family: null }
    case 'url':
      // Measured on the Pro: the player switches to its own push mode, reports
      // the address as the title and plays it, without any account.
      return { command: `setPlayerCmd:play:${action.url}`, family: null }
  }
  // Unreachable while the union above stays covered: it keeps a future action
  // from reaching the writer as an unknown string.
  return { error: 'unsupported action' }
}

// The five writes the device state can refuse come first: the ceiling, the
// input list, the output list, the preset list and the equalizer source are
// what the player reported, so a value outside them is a stale page, not a
// command. Everything else is a template over the value the browser sent.
export const commandFor = (action: Action, device: DeviceState): Outcome => {
  switch (action.action) {
    case 'volume':
      return volumeCommand(action, device)
    case 'source':
      return sourceCommand(action, device)
    case 'output':
      return outputCommand(action, device)
    case 'eqPreset':
      return eqPresetCommand(action, device)
    case 'eqBand':
      return eqBandCommand(action, device)
    default:
      return statelessCommand(action)
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
