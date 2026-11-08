export type Sample = {
  t: number
  rssi: number | null
  volume: number | null
  status: string
  online: boolean
}

export type EventKind = 'online' | 'offline' | 'status' | 'track'

export type DeviceEvent = {
  t: number
  kind: EventKind
  from: string
  to: string
}

export type Device = {
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

export type HubState = {
  ts: number
  pollMs: number
  devices: Device[]
}

export type View = 'user' | 'diagnostic'
