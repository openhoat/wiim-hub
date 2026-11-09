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

// The hub sends machine values, never a sentence: the transition is composed
// here so the log follows the selected language.
export const eventText = (t: Translate, event: DeviceEvent): string => {
  if (event.kind === 'status') return `${statusLabel(t, event.from)} → ${statusLabel(t, event.to)}`
  if (event.kind === 'track') return event.to
  return ''
}

export const agoLabel = (t: Translate, at: number | null, now: number): string => {
  if (at === null) return t('never')
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  return seconds < 60
    ? t('secondsAgo', { n: seconds })
    : t('minutesAgo', { n: Math.round(seconds / 60) })
}
