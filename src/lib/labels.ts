import type { Translate } from './settings'
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
// `server/device.ts` on purpose: the UI bundle and the server image share no
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
  if (event.kind === 'status') return `${statusLabel(t, event.from)} → ${statusLabel(t, event.to)}`
  if (event.kind === 'track') return event.to
  return ''
}

// A write fails for two reasons worth telling apart: the firmware does not
// support it, or it refused the value. `unsupported` is the hub's own token, so
// it gets a sentence; anything else is the device's answer, printed as it came.
export const controlErrorLabel = (t: Translate, error: string | null): string => {
  if (error === null) return ''
  if (error === 'unsupported') return t('controls.unsupported')
  return `${t('controls.failed')} ${error}`
}

export const agoLabel = (t: Translate, at: number | null, now: number): string => {
  if (at === null) return t('never')
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return t('secondsAgo', { n: seconds })
  // Past an hour, minutes stop being readable: an outage is measured in hours.
  if (seconds < 3600) return t('minutesAgo', { n: Math.round(seconds / 60) })
  return t('hoursAgo', { n: Math.round(seconds / 3600) })
}
