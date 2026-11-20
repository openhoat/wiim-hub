import type { Action } from './api'
import { positionOf } from './format'
import type { Device } from './types'

// The lock screen of a phone shows one player, so the page publishes one: the
// card that carries a track. These are what the lock screen can send back, and
// the spec gives each of them a detail: `seekTime` and `seekOffset` are in
// seconds, the rest carry nothing.
export const mediaActions = [
  'play',
  'pause',
  'stop',
  'previoustrack',
  'nexttrack',
  'seekto',
  'seekbackward',
  'seekforward',
] as const

export type MediaAction = (typeof mediaActions)[number]

export type MediaActionDetails = { seekTime?: number; seekOffset?: number }

export type MediaActionHandler = (details: MediaActionDetails) => void

export type MediaPlaybackState = 'none' | 'paused' | 'playing'

export type MediaPositionState = { duration: number; position: number; playbackRate: number }

export type MediaArtwork = { src: string; sizes: string }

export type MediaInfo = {
  title: string
  artist: string
  album: string
  artwork: MediaArtwork[]
}

// The narrow shape the hub needs from `navigator.mediaSession`. A browser that
// does not expose it stays a hub without a media session: the page is unchanged,
// nothing to configure, which is the same promise the event stream keeps.
export type MediaSession = {
  setMetadata: (metadata: MediaInfo | null) => void
  playbackState: MediaPlaybackState
  setActionHandler: (action: MediaAction, handler: MediaActionHandler | null) => void
  setPositionState: (state?: MediaPositionState) => void
}

// What the lock screen draws: the track, who plays it, and the cover the hub
// proxies. The card's own name goes in the album slot, so a group is announced
// as the room the reader settled rather than as the speaker driving it.
export const mediaMetadata = (input: {
  title: string
  artist: string
  album: string
  artwork: string | null
}): MediaInfo => ({
  title: input.title,
  artist: input.artist,
  album: input.album,
  artwork: input.artwork === null ? [] : [{ src: input.artwork, sizes: '512x512' }],
})

// The device reports `play`, `pause`, `stop` and a few vendor states; the media
// session knows three. `stop` is not `paused`: there is nothing to resume at the
// same place, so the controls collapse.
export const mediaPlaybackState = (status: string): MediaPlaybackState => {
  if (status === 'play') return 'playing'
  if (status === 'pause') return 'paused'
  return 'none'
}

// A position the lock screen can draw. The spec wants a finite duration and a
// position inside it, and Chrome throws on anything else: a live stream has no
// duration, so it gets no position at all rather than a bar it cannot fill.
export const mediaPositionState = (input: {
  position: number | null
  totalMs: number | null
}): MediaPositionState | null => {
  if (input.position === null || input.totalMs === null) return null
  const duration = input.totalMs / 1000
  if (!Number.isFinite(duration) || duration <= 0) return null
  const position = Math.min(Math.max(0, input.position / 1000), duration)
  if (!Number.isFinite(position)) return null
  return { duration, position, playbackRate: 1 }
}

// The clock of the page is the one the card is drawn with, and it freezes when
// the hub goes silent: a lock screen that kept counting on a position nobody
// measured would promise a progress the speaker never confirmed.
const seekTo = (device: Device, targetMs: number): Action | null => {
  if (device.totalMs === null || device.totalMs <= 0 || !Number.isFinite(targetMs)) return null
  const clamped = Math.min(Math.max(0, targetMs), device.totalMs)
  return { action: 'seek', seconds: Math.round(clamped / 1000) }
}

// A lock-screen gesture in the hub's own vocabulary: the transport buttons of
// the card, plus the two skips and the seek the browser offers. A live stream
// refuses all three, and a detail the spec declares optional and the browser
// left out sends nothing.
export const mediaCommand = (
  action: MediaAction,
  details: MediaActionDetails,
  device: Device,
  now: number
): Action | null => {
  switch (action) {
    case 'play':
    case 'pause':
    case 'stop':
      return { action }
    case 'nexttrack':
      return { action: 'next' }
    case 'previoustrack':
      return { action: 'prev' }
    case 'seekto':
      if (details.seekTime === undefined) return null
      return seekTo(device, details.seekTime * 1000)
    case 'seekbackward':
    case 'seekforward': {
      if (details.seekOffset === undefined) return null
      const position = positionOf(device, now)
      if (position === null) return null
      const delta = action === 'seekforward' ? details.seekOffset : -details.seekOffset
      return seekTo(device, position + delta * 1000)
    }
  }
}

export const applyMediaMetadata = (session: MediaSession, metadata: MediaInfo): void => {
  session.setMetadata(metadata)
}

// Playback state and position travel together: the bar only means something
// next to the state that makes it move. A browser that refuses the pair (a
// duration of zero, a position past the end) keeps its transport: the write
// fails alone.
export const applyMediaTransport = (
  session: MediaSession,
  input: { status: string; position: number | null; totalMs: number | null }
): void => {
  session.playbackState = mediaPlaybackState(input.status)
  const position = mediaPositionState(input)
  try {
    session.setPositionState(position ?? undefined)
  } catch {
    // A state the browser cannot place: the transport above still stands.
  }
}

// Nothing published, nothing on the lock screen: the page clears the player it
// owned rather than leaving the track of a speaker that stopped.
export const clearMediaSession = (session: MediaSession): void => {
  session.setMetadata(null)
  session.playbackState = 'none'
  try {
    session.setPositionState()
  } catch {
    // same guard as above
  }
}
