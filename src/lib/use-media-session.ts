import { useEffect, useRef, useState } from 'react'
import { type Action, artUrl } from './api'
import { positionOf } from './format'
import {
  applyMediaMetadata,
  applyMediaTransport,
  clearMediaSession,
  type MediaAction,
  type MediaActionDetails,
  type MediaSession,
  mediaActions,
  mediaCommand,
  mediaMetadata,
} from './media-session'
import type { Device } from './types'

// A cover the lock screen can fetch: the hub serves it from its own origin, so
// the relative path the page draws is resolved once against the document.
const artworkUrl = (device: Device): string | null => {
  const path = artUrl(device)
  if (path === null) return null
  try {
    return new URL(path, document.baseURI).href
  } catch {
    return null
  }
}

// `navigator.mediaSession` is a singleton of the document: its metadata setter
// only accepts a MediaMetadata, and the position setter is missing on some
// browsers. The adapter narrows both, so the code above it writes plain objects
// and stays testable, and a browser without the API leaves the page unchanged.
const mediaSessionHost = (): MediaSession | null => {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null
  const real = navigator.mediaSession
  if (real === undefined) return null
  return {
    setMetadata: metadata => {
      if (metadata === null || typeof MediaMetadata === 'undefined') {
        real.metadata = null
        return
      }
      real.metadata = new MediaMetadata(metadata)
    },
    get playbackState() {
      return real.playbackState
    },
    set playbackState(value) {
      real.playbackState = value
    },
    setActionHandler: (action, handler) => real.setActionHandler(action, handler),
    setPositionState: state => {
      if (typeof real.setPositionState !== 'function') return
      real.setPositionState(state)
    },
  }
}

type Options = {
  // The card the page publishes: the lock screen shows one player, never a
  // catalogue, so exactly one card carries this.
  publish: boolean
  // The reading the card draws, optimistic writes included: a pause pressed on
  // the lock screen flips the session before the next poll confirms it.
  device: Device
  run: (action: Action) => Promise<boolean>
  title: string
  // The album slot names the card, so a group is not announced as its master.
  album: string
  now: number
}

// The transport of the card reaches the lock screen, and the lock screen reaches
// the hub: same writes as the buttons of the card, through the same hook, so a
// gesture from the lock screen cannot take a path the page does not. It only
// runs while the page is loaded, which is what a media session is.
export const useMediaSession = (options: Options): void => {
  // Built once, and never in a test: the hook is out of the unit suite, the
  // builders it calls are in it.
  const [host] = useState(mediaSessionHost)
  // The handlers are registered once per published card and read the latest
  // reading here, so a poll does not churn the lock screen.
  const latest = useRef(options)
  latest.current = options
  const { publish, device, title, album, now } = options
  const position = positionOf(device, now)
  // Resolved once per track, not once per poll: the address the lock screen
  // fetches is derived from what the speaker and the hub report.
  const artwork = artworkUrl(device)

  useEffect(() => {
    if (host === null || !publish) return
    const dispatch =
      (action: MediaAction) =>
      (details: MediaActionDetails): void => {
        const reading = latest.current
        const command = mediaCommand(action, details, reading.device, reading.now)
        if (command !== null) void reading.run(command)
      }
    for (const action of mediaActions) host.setActionHandler(action, dispatch(action))
    return () => {
      for (const action of mediaActions) host.setActionHandler(action, null)
    }
  }, [host, publish])

  useEffect(() => {
    // A title that emptied is a track that just ended: the one the lock screen
    // holds stays until the next title is known, rather than blinking away.
    if (host === null || !publish || title === '') return
    applyMediaMetadata(
      host,
      mediaMetadata({
        title,
        artist: device.artist,
        album,
        artwork,
      })
    )
  }, [host, publish, title, album, device.artist, artwork])

  useEffect(() => {
    if (host === null || !publish) return
    applyMediaTransport(host, {
      status: device.status,
      position,
      totalMs: device.totalMs,
    })
  }, [host, publish, device.status, position, device.totalMs])

  // The published card owns the session: when it stops carrying a track, or
  // leaves the page, it clears what it published rather than leaving the lock
  // screen on a speaker that went quiet.
  useEffect(() => {
    if (host === null || !publish) return
    return () => clearMediaSession(host)
  }, [host, publish])
}
