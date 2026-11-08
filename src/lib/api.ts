import type { Device, DeviceSettings, HubState } from './types'

const readJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, { cache: 'no-store', ...init })
  if (!response.ok) {
    // The server answers with a machine message: surface it instead of the
    // status code alone, because "output not available" is actionable and
    // "422" is not.
    let detail = `answered ${response.status}`
    try {
      const body: unknown = await response.json()
      if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
        detail = body.error
      }
    } catch {
      // keep the status code
    }
    throw new Error(detail)
  }
  return (await response.json()) as T
}

export const fetchState = (): Promise<HubState> => readJson<HubState>('/api/state')

export const runDiscovery = (): Promise<{ added: number }> =>
  readJson<{ added: number }>('/api/discover', { method: 'POST' })

// The hub accepts intents, never raw device commands: the shape here is the
// same union the server validates, so a typo fails at compile time.
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

export type CommandResult = { ok: boolean; unsupported: boolean; command: string; body: string }

// The address doubles as the key, so a write lands on the same entry the card
// is reading even after a DHCP lease change resolved the name to a new one.
export const sendCommand = (device: Device, action: Action): Promise<CommandResult> =>
  readJson<CommandResult>(`/api/command?host=${encodeURIComponent(device.ip)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(action),
  })

// Settings are read live when the sheet opens: the device answers four extra
// requests, which the poll does not pay every three seconds.
export const fetchSettings = (device: Device): Promise<DeviceSettings> =>
  readJson<DeviceSettings>(`/api/settings?host=${encodeURIComponent(device.ip)}`)

// Cover art travels through the hub: the page is served over https while the// speaker only answers plain http, and a browser drops that mixed content. The
// device address and the track URI form the cache key, so a cover is fetched
// once per track rather than once per poll.
export const artUrl = (device: Device): string | null => {
  if (device.albumArt === '') return null
  const params = new URLSearchParams({ host: device.ip, uri: device.albumArt })
  return `/api/art?${params.toString()}`
}

export const presetArtUrl = (device: Device, uri: string): string | null => {
  if (uri === '') return null
  const params = new URLSearchParams({ host: device.ip, uri })
  return `/api/art?${params.toString()}`
}
