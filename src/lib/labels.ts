import type { ResolvedLang, Translate } from './i18n'
import type { DeviceEvent } from './types'

// Device states are short tokens. A translated token wins; an unknown one is
// printed as is rather than shown as a missing key.
export const statusLabel = (t: Translate, status: string): string => {
  if (status === '') return t('statuses.none')
  const key = `statuses.${status}`
  const value = t(key)
  return value === key ? status : value
}

export const eventKindLabel = (t: Translate, kind: DeviceEvent['kind']): string => {
  const key = `events.${kind}`
  const value = t(key)
  return value === key ? kind : value
}

// An external input carries a signal, not a track: the analogue and optical
// sources have no media to seek in and no metadata to show. The server already
// nulls the position they report, but the page still has to name the source
// instead of pretending nothing is playing. The list repeats the one in
// `server/device/status.ts` on purpose: the UI bundle and the server image share no
// module, and the device ids are the only stable key here.
const externalInputs = new Set(['optical', 'line-in'])

export const isExternalInput = (input: string): boolean => externalInputs.has(input)

// A label the user set in the vendor app wins, then the built-in name of the
// input; an id that is not translated prints as is, like a device state.
export const inputLabel = (t: Translate, labels: Record<string, string>, input: string): string => {
  const renamed = labels[input]
  if (renamed !== undefined && renamed !== '') return renamed
  const key = `inputs.${input}`
  const value = t(key)
  return value === key ? input : value
}

// The hub sends machine values, never a sentence: the transition is composed
// here so the log follows the selected language.
export const eventText = (t: Translate, event: DeviceEvent): string => {
  if (event.kind === 'status') {
    return t('events.transition', {
      from: statusLabel(t, event.from),
      to: statusLabel(t, event.to),
    })
  }
  if (event.kind === 'track') return event.to
  return ''
}

// A write fails for two reasons worth telling apart: the firmware does not
// support it, or it refused the value. `unsupported` is the hub's own token, so
// it gets a sentence; anything else is the device's answer, plugged into the
// sentence that introduces it.
export const controlErrorLabel = (t: Translate, error: string | null): string => {
  if (error === null) return ''
  if (error === 'unsupported') return t('controls.unsupported')
  return t('controls.failed', { error })
}

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>()

const relativeFormat = (locale: string): Intl.RelativeTimeFormat => {
  const known = relativeFormats.get(locale)
  if (known !== undefined) return known
  // `auto` says "yesterday" and "now" where a duration alone would read stiffly.
  const created = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  relativeFormats.set(locale, created)
  return created
}

// Buckets rather than a continuous number: past an hour, minutes stop being
// readable, and past a day the outage is a calendar fact. Rounded down, so an
// age is never flattered.
const unitOf = (seconds: number): [number, Intl.RelativeTimeFormatUnit] => {
  if (seconds < 60) return [seconds, 'second']
  if (seconds < 3600) return [Math.floor(seconds / 60), 'minute']
  if (seconds < 86_400) return [Math.floor(seconds / 3600), 'hour']
  return [Math.floor(seconds / 86_400), 'day']
}

export const agoLabel = (
  t: Translate,
  locale: ResolvedLang,
  at: number | null,
  now: number
): string => {
  if (at === null) return t('never')
  const [value, unit] = unitOf(Math.max(0, Math.round((now - at) / 1000)))
  return relativeFormat(locale).format(-value, unit)
}
