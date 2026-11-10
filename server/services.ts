// The streaming services a player can drive, and the quality levels its
// firmware publishes for each. This is a reference table, not live state: it
// changes with a firmware update, so it is probed on demand and kept for the
// same window as the capability inventory.
//
// The payload has no uniform shape, and that is the whole story of this module.
// Some families list a ladder of names (`SD < HD < UHD`), one lists a vendor
// enum (Qobuz answers format ids), one lists bitrates, one lists codec tokens,
// and most list nothing at all because the vendor app decides what to stream.
// The parser keeps the levels exactly as published and in the published order:
// the page names the last one as the top tier, and what the firmware does not
// say, the hub does not invent.
import { resolveTarget } from './device/resolve.ts'
import { fetchCommand } from './device/transport.ts'
import type { ProbeCommand } from './inventory.ts'

export type ServiceCapability = {
  id: string
  version: string
  // In the order the device lists them, which is ascending on every family
  // seen so far: ranking them here would encode a vendor table the hub has no
  // source for.
  levels: string[]
  replayGain: boolean
  configurable: boolean
  active: boolean
}

const flag = (value: unknown): boolean => value === true || value === 1 || value === '1'

const levelsOf = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const levels: string[] = []
  for (const entry of value) {
    // Some builds answer a bitrate as a number, others as its string form.
    if (typeof entry !== 'string' && typeof entry !== 'number') continue
    const level = String(entry).trim()
    if (level !== '' && !levels.includes(level)) levels.push(level)
  }
  return levels
}

// `null` for anything that is not a service list: `unknown command`, an empty
// body, a firmware that answers the command name alone. The caller keeps what
// it already knew, exactly as the capability and preset seams do.
export const parseServicesCapability = (raw: string | null): ServiceCapability[] | null => {
  if (raw === null) return null
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const entries = (body as { streamServices?: unknown }).streamServices
  if (!Array.isArray(entries)) return null
  const services: ServiceCapability[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (id === '' || services.some(service => service.id === id)) continue
    services.push({
      id,
      version: typeof record.version === 'string' ? record.version : '',
      levels: levelsOf(record.quality),
      replayGain: flag(record.replayGain),
      // `configurable` marks a cast endpoint: the hub cannot list its levels
      // because the app that casts to it owns them. `active` says the endpoint
      // is running on the player, not that it is the current source: the Pro
      // answers `active` for Spotify while it plays YouTube Music, so the page
      // marks what plays from `getPlayerStatusEx`, never from this flag.
      configurable: flag(record.configurable),
      active: flag(record.active),
    })
  }
  return services.length > 0 ? services : null
}

const servicesTtlMs = 300_000
const servicesCache = new Map<string, { at: number; value: ServiceCapability[] }>()

// One request per address per window, and a failed probe never erases what the
// model already published: a player that goes quiet for a minute must not empty
// the table the page is reading.
export const readServices = async (
  host: string,
  now = Date.now(),
  probe: ProbeCommand = fetchCommand
): Promise<ServiceCapability[]> => {
  // Keyed by address, like the inventory: the same player reached by name and
  // by address is one player, probed once.
  const ip = resolveTarget(host)
  const cached = servicesCache.get(ip)
  if (cached !== undefined && now - cached.at < servicesTtlMs) return cached.value
  const parsed = parseServicesCapability(await probe(ip, 'streamServicesCapability'))
  if (parsed === null) return cached?.value ?? []
  servicesCache.set(ip, { at: now, value: parsed })
  return parsed
}
