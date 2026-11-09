export type Sample = {
  t: number
  rssi: number | null
  volume: number | null
  status: string
  online: boolean
}

export type EventKind = 'online' | 'offline' | 'status' | 'track'

export type Preset = { number: number; name: string; artwork: string }

export type OutputOption = { hardware: number; name: string }

export type EqBand = { name: string; value: number }

export type Equalizer = {
  enabled: boolean
  name: string
  source: string
  bands: EqBand[]
  presets: string[]
  roomFit: boolean
}

export type Quality = { sampleRate: number | null; bitDepth: number | null; bitRate: number | null }

// Read on demand when the settings sheet opens, not on every poll.
export type DeviceSettings = {
  name: string
  ledOn: boolean | null
  buttonsOn: boolean | null
  balance: number | null
  maxVolume: number | null
  fade: boolean | null
}

export type DeviceEvent = {
  t: number
  kind: EventKind
  from: string
  to: string
}

export type GroupMember = { name: string; ip: string; uuid: string }

// Multiroom, read only: `role` is what this speaker does in the group,
// `members` is what the device lists, and `saved` says the vendor app keeps a
// group while nothing runs.
export type GroupState = {
  role: 'none' | 'master' | 'member'
  name: string
  members: GroupMember[]
  saved: boolean
}

export type Device = {
  ip: string
  name: string
  model: string
  firmware: string
  release: string
  ssid: string
  bssid: string
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
  // What the UPnP subscription is doing: `off` when the hub has no callback the
  // players can reach, `subscribed` when they push their changes, `degraded`
  // when a poll contradicted the channel and the fast poll took over.
  upnp: UpnpStatus
  samples: Sample[]
  events: DeviceEvent[]
}

export type UpnpStatus = {
  state: 'off' | 'subscribed' | 'degraded'
  lastEventAt: number | null
  events: number
  misses: number
}

export type HubState = {
  ts: number
  pollMs: number
  devices: Device[]
}

export type View = 'user' | 'diagnostic'
