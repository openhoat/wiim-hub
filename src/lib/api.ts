import type { Device, DeviceSettings, Finding, HubState, ServiceCapability } from './types'

const readJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, { cache: 'no-store', ...init })
  if (!response.ok) {
    // The server answers with a machine message: surface it instead of the
    // status code alone, because "output not available" is actionable and
    // "422" is not.
    let detail = `answered ${response.status}`
    try {
      const body: unknown = await response.json()
      if (
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof body.error === 'string'
      ) {
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

// The report is built by the server, in English, so the page and the support
// thread show the same sentences and the same evidence. The page only reads the
// Markdown: the inventory and the resolution are carried for the API consumer.
export type Report = { ts: number; host: string; findings: Finding[]; markdown: string }

export const fetchReport = (device: Device): Promise<Report> =>
  readJson<Report>(`/api/report?host=${encodeURIComponent(device.ip)}`)

// Reference data, read when the diagnostic card opens: the firmware's streaming
// table, with the levels it publishes per service.
export type ServicesAnswer = { ts: number; host: string; services: ServiceCapability[] }

export const fetchServices = (host: string): Promise<ServicesAnswer> =>
  readJson<ServicesAnswer>(`/api/services?host=${encodeURIComponent(host)}`)

export const runDiscovery = (): Promise<{ added: number }> =>
  readJson<{ added: number }>('/api/discover', { method: 'POST' })

// The addresses the hub polls, with the list they came from. Only a `saved`
// entry belongs to the page: the environment seed is the operator's, and a
// discovered host is kept by saving it.
export type HostSource = 'env' | 'saved' | 'discovered'

export type HostEntry = {
  host: string
  source: HostSource
  ip: string
  online: boolean
  name: string
}

export const fetchHosts = (): Promise<{ hosts: HostEntry[] }> => readJson('/api/hosts')

// The three writes answer the list they produced, so the dialog never re-reads
// what the server already knows.
const writeHost = (init: RequestInit): Promise<{ hosts: HostEntry[] }> =>
  readJson('/api/hosts', {
    ...init,
    headers: { 'content-type': 'application/json' },
  })

export const addHost = (host: string): Promise<{ hosts: HostEntry[] }> =>
  writeHost({ method: 'POST', body: JSON.stringify({ host }) })

export const renameHost = (from: string, to: string): Promise<{ hosts: HostEntry[] }> =>
  writeHost({ method: 'PUT', body: JSON.stringify({ from, to }) })

export const removeHost = (host: string): Promise<{ hosts: HostEntry[] }> =>
  readJson(`/api/hosts?host=${encodeURIComponent(host)}`, { method: 'DELETE' })

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
// The route validates the uri against the answer of the host it is given, so the
// caller names the speaker that reported the cover: for a member of a group that
// is the master, and the two are not interchangeable.
export const artUrl = (device: Pick<Device, 'ip' | 'albumArt'>): string | null => {
  if (device.albumArt === '' || device.ip === '') return null
  const params = new URLSearchParams({ host: device.ip, uri: device.albumArt })
  return `/api/art?${params.toString()}`
}

export const presetArtUrl = (device: Device, uri: string): string | null => {
  if (uri === '') return null
  const params = new URLSearchParams({ host: device.ip, uri })
  return `/api/art?${params.toString()}`
}
