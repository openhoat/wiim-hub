// How a streaming tier is named on screen. The rule the whole card follows: say
// what the firmware published, in the order it published it, and translate only
// what the payload carries a meaning for. A family that names its levels
// (`LOSSLESS`, `UHD`) needs no table; a numeric one does, or it would show a
// bare number with no unit; a token that spells its codec and rate translates
// itself.
//
// What is deliberately absent: bitrates for the named ladders. `HI_RES` is what
// this model reports, and turning it into `24 bit / 192 kHz` would be a claim
// about a vendor catalogue, not a measurement of the player in front of you.
import type { ServiceCapability } from './types'

// Qobuz answers format ids instead of names. Its API documents them: 5 is
// MP3 320, 6 is CD quality, 7 and 27 are the two Hi-Res steps.
const qobuzFormats: Record<string, string> = {
  '5': 'MP3 320',
  '6': 'FLAC 16/44.1',
  '7': 'FLAC 24 ≤ 96 kHz',
  '27': 'FLAC 24 ≤ 192 kHz',
}

const codecToken = /^(flac|alac|aac|mp3|opus)_(\d+)/i

const bareNumber = /^\d+$/

// The families whose numeric levels are bitrates. Kept short and explicit: a
// number alone is a vendor id until a source says otherwise.
const bitrateFamilies = new Set(['calmradio'])

export const levelLabel = (id: string, level: string): string => {
  const family = id.toLowerCase()
  if (bareNumber.test(level)) {
    if (family === 'qobuz' && qobuzFormats[level] !== undefined) return qobuzFormats[level]
    if (bitrateFamilies.has(family)) return `${level} kbps`
    return level
  }
  const token = codecToken.exec(level)
  if (token !== null) {
    const codec = token[1].toUpperCase()
    const value = token[2]
    return codec === 'FLAC' || codec === 'ALAC' ? `${codec} ${value} bit` : `${codec} ${value} kbps`
  }
  return level.toUpperCase()
}

export type ServiceTier = { top: string; ladder: string }

// The top tier is the last level the device listed: on every family seen so
// far, that list is ascending, and trusting it avoids ranking vendors here.
export const tierOf = (service: ServiceCapability): ServiceTier | null => {
  const levels = service.levels
  if (levels.length === 0) return null
  const named = levels.map(level => levelLabel(service.id, level))
  return { top: named[named.length - 1], ladder: named.join(' < ') }
}

export const isActive = (service: ServiceCapability, playing: string): boolean =>
  playing !== '' && service.id.toLowerCase() === playing.toLowerCase()

// What the page shows first: the service in use, then the ones that publish a
// tier, then the rest. Inside a group the order is stable, so a refresh does not
// shuffle the table under the pointer.
export const orderServices = (
  services: ServiceCapability[],
  playing: string
): ServiceCapability[] => {
  const rank = (service: ServiceCapability): number => {
    if (isActive(service, playing)) return 0
    return service.levels.length > 0 ? 1 : 2
  }
  return [...services].sort(
    (left, right) => rank(left) - rank(right) || left.id.localeCompare(right.id)
  )
}
