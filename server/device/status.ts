import { num } from './payload.ts'

// What the page paints for a device over time, and the state itself: the status
// answers (`getStatusEx`, `getPlayerStatusEx`, `getMetaInfo`) plus the rules that
// turn their awkward values into a card.
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

export const MAX_SAMPLES = 400
export const MAX_EVENTS = 40

export const cleanModel = (value: string): string =>
  value
    .replace(/_with_.*$/i, '')
    .replaceAll('_', ' ')
    .trim()

// getStatusEx repeats the field with a lowercase key on some builds and as
// RSSI on others: read both, keep the first numeric value.
export const readRssi = (status: Record<string, unknown> | null): number | null =>
  num(status?.RSSI) ?? num(status?.rssi)

// Playback mode -> input id. The network families all play through the wifi
// input, which is also what `setPlayerCmd:switchmode:wifi` switches back to:
// the device playlist (10-19), the cast family (5, measured with `vendor:
// CAST`) and the streaming services documented in the research notes (31
// Spotify, 32 TIDAL, 36 Qobuz). A cast is a network input, not a source of its
// own: without this the source row lights nothing up while the speaker casts.
// The analogue and digital inputs keep their own codes; anything else stays
// unknown rather than lighting up the wrong source.
const NETWORK_MODES = new Set([5, 31, 32, 36])

export const inputFromMode = (mode: string): string => {
  const code = Number.parseInt(mode, 10)
  if (!Number.isFinite(code)) return ''
  if (code >= 10 && code <= 19) return 'wifi'
  if (NETWORK_MODES.has(code)) return 'wifi'
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

// The payload does not say which unit `curpos` and `totlen` are in: milliseconds
// for local and AirPlay sources, microseconds for streaming services on some
// firmwares (`docs/feature-research.md`, §5.1). Ten hours is the frontier that
// tells the two apart: no track is long enough to reach it in milliseconds on a
// streaming source, and a position in microseconds passes it after 36 seconds.
// The local sources are exempt because their unit is known, which is how a file
// longer than ten hours keeps its real position; no mode code maps to them yet
// (`inputFromMode`), so the exemption is a guard for the day one does.
export const POSITION_UNIT_THRESHOLD = 36_000_000

const LOCAL_INPUTS = new Set(['udisk', 'HDMI'])

export const positionMs = (value: number | null, input: string): number | null => {
  if (value === null || value <= 0) return value
  if (LOCAL_INPUTS.has(input)) return value
  return value > POSITION_UNIT_THRESHOLD ? Math.round(value / 1000) : value
}

// `getMetaInfo` reports the stream numbers as strings; they describe the codec
// in flight, not the device, so they reset to nothing when playback stops.
export const readQuality = (metaData: Record<string, unknown>): Quality => ({
  sampleRate: num(metaData.sampleRate),
  bitDepth: num(metaData.bitDepth),
  bitRate: num(metaData.bitRate),
})
