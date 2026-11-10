// Positions and durations come from the device as milliseconds; the UI only
// needs a compact clock, never a locale-formatted date string.
export const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

// Formatters are built once per locale: the page formats a timestamp on every
// tick, for every sample row, and building an Intl object is the expensive part.
const numberFormats = new Map<string, Intl.NumberFormat>()
const clockFormats = new Map<string, Intl.DateTimeFormat>()

const cached = <T>(cache: Map<string, T>, locale: string, build: () => T): T => {
  const known = cache.get(locale)
  if (known !== undefined) return known
  const created = build()
  cache.set(locale, created)
  return created
}

// French groups thousands with U+202F, a narrow no-break space that some
// Chromium font stacks drop; the full-width no-break space renders everywhere
// and reads the same.
export const formatNumber = (value: number, locale: string): string =>
  cached(numberFormats, locale, () => new Intl.NumberFormat(locale))
    .format(value)
    .replace(/\u202f/g, '\u00a0')

export const formatClock = (at: number, locale: string): string =>
  cached(
    clockFormats,
    locale,
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  ).format(at)

// A device reports its position at poll time: extrapolating while it plays
// keeps the bar moving instead of stepping every few seconds.
export const positionOf = (
  device: {
    curposMs: number | null
    totalMs: number | null
    status: string
    updatedAt: number | null
  },
  now: number = Date.now()
): number | null => {
  if (device.curposMs === null || device.totalMs === null) return null
  const elapsed =
    device.status === 'play' && device.updatedAt !== null ? Math.max(0, now - device.updatedAt) : 0
  return Math.min(device.totalMs, device.curposMs + elapsed)
}

export const csvOf = (
  samples: {
    t: number
    rssi: number | null
    volume: number | null
    status: string
    online: boolean
  }[]
): string => {
  const rows = [['time', 'rssi_dbm', 'volume', 'state', 'online']]
  for (const sample of samples) {
    rows.push([
      new Date(sample.t).toISOString(),
      sample.rssi === null ? '' : String(sample.rssi),
      sample.volume === null ? '' : String(sample.volume),
      sample.status,
      sample.online ? '1' : '0',
    ])
  }
  return rows.map(row => row.join(',')).join('\n')
}

export const download = (filename: string, content: string, type: string): void => {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export const fileStamp = (): string => new Date().toISOString().replace(/[:.]/g, '-')
