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

// The radio, read from the same poll as the rest of the status.
export type LinkMetrics = {
  snr: number | null
  noise: number | null
  freqMhz: number | null
  rateMbps: number | null
}

export type CrashCounters = {
  controller: number | null
  asrTts: number | null
  mcu: number | null
  deadlock: number | null
}

// The three diagnostic probes, refreshed on their own slow cadence.
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
    crashes: CrashCounters
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

// A finding is a fact, not a diagnosis: the id names the rule, `values` feeds
// the sentence, and `evidence` carries the raw numbers with their source.
export type Finding = {
  id: FindingId
  severity: 'alert' | 'warn' | 'info'
  values: Record<string, string | number>
  evidence: string[]
}

// The client cannot import from the server (the runtime image ships only
// `server/` and `dist/`), so the rule ids are mirrored here. `findings.test.ts`
// on the server and the `findings.*` locale keys keep the two in step.
export type FindingId =
  | 'offline'
  | 'weakLink'
  | 'wifiDrops'
  | 'ethDrops'
  | 'pingFailures'
  | 'abnormalReboots'
  | 'crashCounters'
  | 'flashWear'
  | 'hardwareFault'
  | 'upnpActionsLost'
  | 'eventingDegraded'
  | 'sleepTimer'

// The four guided checks, same split as the findings: the server decides and
// names the field it read, the page translates. `unknown` means the check could
// not be read, which is not a pass.
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown'

export type GuideCheck = {
  id: string
  status: CheckStatus
  values: Record<string, string | number>
  evidence: string
}

export type GuideId = 'no-sound' | 'drops' | 'wrong-output' | 'cannot-join-group'

export type Guide = {
  id: GuideId
  checks: GuideCheck[]
  verdict: GuideCheck | null
  settled: boolean
}

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
  // What the UPnP subscription is doing: `off` when the hub has no callback the
  // players can reach, `subscribed` when they push their changes, `degraded`
  // when a poll contradicted the channel and the fast poll took over.
  upnp: UpnpStatus
  link: LinkMetrics
  diagnostics: Diagnostics | null
  // Recomputed on every `/api/state`: a counter that recovered stops showing.
  findings: Finding[]
  guides: Guide[]
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
