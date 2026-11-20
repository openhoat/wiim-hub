import { describe, expect, test } from 'vitest'
import {
  applyMediaMetadata,
  applyMediaTransport,
  clearMediaSession,
  type MediaAction,
  type MediaActionHandler,
  type MediaInfo,
  type MediaPlaybackState,
  type MediaPositionState,
  type MediaSession,
  mediaCommand,
  mediaMetadata,
  mediaPlaybackState,
  mediaPositionState,
} from './media-session.ts'
import type { Device } from './types'

const device = (overrides: Partial<Device> = {}): Device => ({
  ip: '192.0.2.21',
  name: 'Living Room',
  model: 'WiiM Pro',
  firmware: 'Linkplay.4.8.833748',
  release: '20261027',
  ssid: 'HomeNet-5G',
  bssid: '02:00:00:00:00:05',
  wmrmVersion: '4.3',
  uuid: 'A1B2C3D4E5F60718293A4B5C',
  mirror: null,
  group: { role: 'none', name: '', members: [], saved: false, parent: null },
  rssi: -51,
  volume: 44,
  status: 'play',
  title: 'Late Ferry',
  artist: 'The Harbour Lights',
  album: 'Night Crossings',
  albumArt: 'demo://cover/night-crossings',
  curposMs: 68_000,
  totalMs: 254_000,
  source: 'Tidal',
  mode: '31',
  input: 'wifi',
  maxVolume: 100,
  mute: false,
  sleepSeconds: 0,
  inputs: [],
  inputLabels: {},
  outputs: [],
  outputHardware: null,
  presets: [],
  eq: { enabled: false, name: '', source: 'wifi', bands: [], presets: [], roomFit: false },
  quality: { sampleRate: 48_000, bitDepth: 16, bitRate: 1411 },
  updatedAt: 1_000,
  online: true,
  lastSeen: 1_000,
  errors: 0,
  upnp: { state: 'off', lastEventAt: null, events: 0, misses: 0 },
  link: { snr: 35, noise: -91, freqMhz: 5260, rateMbps: 433 },
  diagnostics: null,
  findings: [],
  guides: [],
  samples: [],
  events: [],
  ...overrides,
})

// The session the browser exposes cannot be built in Node, so the writers are
// checked against a recorder: what the lock screen would receive, in order.
const recorder = () => {
  const written = {
    metadata: [] as (MediaInfo | null)[],
    playback: [] as MediaPlaybackState[],
    positions: [] as (MediaPositionState | undefined)[],
    handlers: new Map<MediaAction, MediaActionHandler | null>(),
    refusePosition: false,
  }
  const session: MediaSession = {
    setMetadata: metadata => {
      written.metadata.push(metadata)
    },
    get playbackState() {
      return written.playback[written.playback.length - 1] ?? 'none'
    },
    set playbackState(value: MediaPlaybackState) {
      written.playback.push(value)
    },
    setActionHandler: (action, handler) => {
      written.handlers.set(action, handler)
    },
    setPositionState: state => {
      if (written.refusePosition) throw new TypeError('position out of range')
      written.positions.push(state)
    },
  }
  return { session, written }
}

describe('mediaMetadata', () => {
  test('names the track, the artist and the card, with the cover the hub proxies', () => {
    expect(
      mediaMetadata({
        title: 'Late Ferry',
        artist: 'The Harbour Lights',
        album: 'Apartment',
        artwork: 'https://wiim.example/api/art?host=192.0.2.21',
      })
    ).toEqual({
      title: 'Late Ferry',
      artist: 'The Harbour Lights',
      album: 'Apartment',
      artwork: [{ src: 'https://wiim.example/api/art?host=192.0.2.21', sizes: '512x512' }],
    })
  })

  test('publishes no artwork rather than a broken image', () => {
    expect(
      mediaMetadata({ title: 'Late Ferry', artist: '', album: 'Apartment', artwork: null }).artwork
    ).toEqual([])
  })
})

describe('mediaPlaybackState', () => {
  test('maps the device states onto the three the lock screen knows', () => {
    expect(mediaPlaybackState('play')).toBe('playing')
    expect(mediaPlaybackState('pause')).toBe('paused')
    expect(mediaPlaybackState('stop')).toBe('none')
    expect(mediaPlaybackState('idle')).toBe('none')
  })
})

describe('mediaPositionState', () => {
  test('converts the milliseconds the hub reports into seconds', () => {
    expect(mediaPositionState({ position: 68_000, totalMs: 254_000 })).toEqual({
      duration: 254,
      position: 68,
      playbackRate: 1,
    })
  })

  test('keeps the position inside the track', () => {
    expect(mediaPositionState({ position: -400, totalMs: 254_000 })?.position).toBe(0)
    expect(mediaPositionState({ position: 300_000, totalMs: 254_000 })?.position).toBe(254)
  })

  test('gives a live stream no position at all', () => {
    expect(mediaPositionState({ position: 12_000, totalMs: null })).toBeNull()
    expect(mediaPositionState({ position: 12_000, totalMs: 0 })).toBeNull()
    expect(mediaPositionState({ position: null, totalMs: 254_000 })).toBeNull()
  })

  test('refuses a value a lock screen could not draw', () => {
    expect(mediaPositionState({ position: 12_000, totalMs: Number.POSITIVE_INFINITY })).toBeNull()
    expect(mediaPositionState({ position: Number.NaN, totalMs: 254_000 })).toBeNull()
  })
})

describe('mediaCommand', () => {
  test('turns a transport gesture into the card command', () => {
    const speaker = device()
    expect(mediaCommand('play', {}, speaker, 1_000)).toEqual({ action: 'play' })
    expect(mediaCommand('pause', {}, speaker, 1_000)).toEqual({ action: 'pause' })
    expect(mediaCommand('stop', {}, speaker, 1_000)).toEqual({ action: 'stop' })
    expect(mediaCommand('nexttrack', {}, speaker, 1_000)).toEqual({ action: 'next' })
    expect(mediaCommand('previoustrack', {}, speaker, 1_000)).toEqual({ action: 'prev' })
  })

  test('seeks where the lock screen dropped the thumb', () => {
    expect(mediaCommand('seekto', { seekTime: 42 }, device(), 1_000)).toEqual({
      action: 'seek',
      seconds: 42,
    })
  })

  test('clamps a seek into the track', () => {
    expect(mediaCommand('seekto', { seekTime: 9_999 }, device(), 1_000)).toEqual({
      action: 'seek',
      seconds: 254,
    })
    expect(mediaCommand('seekto', { seekTime: -9 }, device(), 1_000)).toEqual({
      action: 'seek',
      seconds: 0,
    })
  })

  test('seeks by an offset from the position the page draws', () => {
    // One second of playing since the reading: the skip starts from the position
    // on screen, not from the last poll.
    expect(mediaCommand('seekforward', { seekOffset: 10 }, device(), 2_000)).toEqual({
      action: 'seek',
      seconds: 79,
    })
    expect(mediaCommand('seekbackward', { seekOffset: 10 }, device(), 2_000)).toEqual({
      action: 'seek',
      seconds: 59,
    })
  })

  test('refuses a seek on a live stream, and a detail the browser left out', () => {
    const live = device({ totalMs: null })
    expect(mediaCommand('seekto', { seekTime: 42 }, live, 1_000)).toBeNull()
    expect(mediaCommand('seekforward', { seekOffset: 10 }, live, 1_000)).toBeNull()
    expect(mediaCommand('seekto', {}, device(), 1_000)).toBeNull()
    expect(mediaCommand('seekforward', {}, device(), 1_000)).toBeNull()
    expect(mediaCommand('seekbackward', {}, device({ curposMs: null }), 1_000)).toBeNull()
    expect(mediaCommand('seekto', { seekTime: Number.NaN }, device(), 1_000)).toBeNull()
  })
})

describe('applyMediaMetadata', () => {
  test('hands the metadata to the session', () => {
    const { session, written } = recorder()
    const info = mediaMetadata({ title: 'Late Ferry', artist: 'A', album: 'B', artwork: null })
    applyMediaMetadata(session, info)
    expect(written.metadata).toEqual([info])
  })
})

describe('applyMediaTransport', () => {
  test('writes the state and the position together', () => {
    const { session, written } = recorder()
    applyMediaTransport(session, { status: 'play', position: 68_000, totalMs: 254_000 })
    expect(written.playback).toEqual(['playing'])
    expect(written.positions).toEqual([{ duration: 254, position: 68, playbackRate: 1 }])
  })

  test('clears the position of a live stream', () => {
    const { session, written } = recorder()
    applyMediaTransport(session, { status: 'play', position: 68_000, totalMs: null })
    expect(written.positions).toEqual([undefined])
  })

  test('keeps the transport when the browser refuses the position', () => {
    const { session, written } = recorder()
    written.refusePosition = true
    expect(() =>
      applyMediaTransport(session, { status: 'play', position: 68_000, totalMs: 254_000 })
    ).not.toThrow()
    expect(written.playback).toEqual(['playing'])
  })
})

describe('clearMediaSession', () => {
  test('empties what the page published', () => {
    const { session, written } = recorder()
    applyMediaMetadata(
      session,
      mediaMetadata({ title: 'Late Ferry', artist: 'A', album: 'B', artwork: null })
    )
    clearMediaSession(session)
    expect(written.metadata).toEqual([
      mediaMetadata({ title: 'Late Ferry', artist: 'A', album: 'B', artwork: null }),
      null,
    ])
    expect(written.playback).toEqual(['none'])
    expect(written.positions).toEqual([undefined])
  })

  test('survives a browser that refuses the empty position', () => {
    const { session, written } = recorder()
    written.refusePosition = true
    expect(() => clearMediaSession(session)).not.toThrow()
    expect(written.metadata).toEqual([null])
  })
})
