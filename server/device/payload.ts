// The readers every area shares. An answer is JSON, a bare token, or a number
// spelled as text, and the same field comes back in different shapes on
// different builds: these are the only places that decide how to read one, so a
// new area reads its payload the same way as the others.
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const isArray = (value: unknown): value is unknown[] => Array.isArray(value)

export const parseJson = (raw: string | null): Record<string, unknown> | null => {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

export const parseArray = (raw: string | null): unknown[] | null => {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    return isArray(value) ? value : null
  } catch {
    return null
  }
}

export const text = (value: unknown): string => (typeof value === 'string' ? value : '')

// `getStatusEx` answers strings ("-53"), while the diagnostic counters of
// `getNetworkHealth` and `getHwErrorInfo` come back as numbers (2, 5, 2000):
// reading only strings left every one of those counters null, and a rule that
// reads a null counter stays silent. The verbose field names are part of the
// firmware, not a quirk of one build.
export const num = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const parsed = Number.parseInt(text(value), 10)
  return Number.isFinite(parsed) ? parsed : null
}

// Idle firmware reports the placeholder "Unknown" as the track title: it is a
// device artefact, not a track, so it must not reach the card.
export const cleanTitle = (value: string): string =>
  /^unknow?n?$/i.test(value.trim()) ? '' : value

// The same firmware answers `un_known` for a cover it does not have: relaying
// that string produces a broken image on every poll of a stopped player. The
// spelling varies by model (`unknown`, `unknow`, `un-known`), so match the stem.
export const artUri = (value: string): string => {
  const uri = value.trim()
  return /^(un[_-]?know?n?|-)$/i.test(uri) ? '' : uri
}

// Firmware encodes some strings as hex (essid, Title): decode only when the
// bytes read as printable text, so numeric values stay untouched.
export const maybeHex = (value: string): string => {
  if (value.length >= 6 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value)) {
    const decoded = Buffer.from(value, 'hex').toString('utf8')
    if (/^[\p{L}\p{N}\s\p{P}]+$/u.test(decoded)) return decoded
  }
  return value
}
