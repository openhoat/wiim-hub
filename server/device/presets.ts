import { artUri, isRecord, num, parseJson, text } from './payload.ts'
import { probeCommand } from './probes.ts'

// A saved radio preset. The slot number is the identity: the list a device
// reports is sparse (slots 1 and 6 are a valid answer), so the array index is
// never a usable key.
export type Preset = { number: number; name: string; artwork: string }

const presetTtlMs = 60_000
export const presetCache = new Map<string, { at: number; value: Preset[] }>()

// Same seam as `parseCapability`: an answer that is not a preset list (an
// `unknown command`, an empty body) returns `null` so the caller can keep what
// it already knew. A slot without a usable number is skipped, an absent name
// falls back to the number, and the list comes out ordered.
export const parsePresets = (raw: string | null): Preset[] | null => {
  const info = parseJson(raw)
  const entries = Array.isArray(info?.preset_list) ? info.preset_list : null
  if (entries === null) return null
  const value: Preset[] = []
  for (const entry of entries) {
    if (!isRecord(entry)) continue
    const number = num(entry.number)
    if (number === null || number <= 0) continue
    value.push({
      number,
      name: text(entry.name) || String(number),
      artwork: artUri(text(entry.picurl)),
    })
  }
  value.sort((left, right) => left.number - right.number)
  return value
}

export const presetsFor = async (ip: string, firmware: string): Promise<Preset[]> => {
  const cached = presetCache.get(ip)
  if (cached !== undefined && Date.now() - cached.at < presetTtlMs) return cached.value
  const parsed = parsePresets(await probeCommand(ip, firmware, 'getPresetInfo'))
  if (parsed === null) return cached?.value ?? []
  presetCache.set(ip, { at: Date.now(), value: parsed })
  return parsed
}
