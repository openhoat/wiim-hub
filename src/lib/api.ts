import type { Device, HubState } from './types'

const readJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, { cache: 'no-store', ...init })
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return (await response.json()) as T
}

export const fetchState = (): Promise<HubState> => readJson<HubState>('/api/state')

export const runDiscovery = (): Promise<{ added: number }> =>
  readJson<{ added: number }>('/api/discover', { method: 'POST' })

// Cover art travels through the hub: the page is served over https while the
// speaker only answers plain http, and a browser drops that mixed content. The
// device address and the track URI form the cache key, so a cover is fetched
// once per track rather than once per poll.
export const artUrl = (device: Device): string | null => {
  if (device.albumArt === '') return null
  const params = new URLSearchParams({ host: device.ip, uri: device.albumArt })
  return `/api/art?${params.toString()}`
}
