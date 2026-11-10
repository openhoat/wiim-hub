import { describe, expect, it } from 'vitest'
import { optimisticFor, overrideLifetimeMs, withOverride } from './optimistic.ts'
import type { Device } from './types'

// A device payload as the hub serves it, kept minimal: only the fields the
// optimistic override reads or paints carry a value worth reading here.
const device = (overrides: Partial<Device> = {}): Device => ({
  ip: '192.0.2.150',
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
  volume: 40,
  status: 'pause',
  title: 'Gogol',
  artist: 'Chilly Gonzales',
  album: 'Solo Piano',
  albumArt: '',
  curposMs: 30_000,
  totalMs: 120_000,
  source: 'wifi',
  mode: '10',
  input: 'wifi',
  maxVolume: 100,
  mute: false,
  sleepSeconds: 0,
  inputs: ['wifi', 'optical'],
  inputLabels: {},
  outputs: [{ hardware: 2, name: 'Line Out' }],
  outputHardware: 2,
  presets: [],
  eq: {
    enabled: false,
    name: 'Rock',
    source: 'wifi',
    bands: [
      { name: 'band1khz', value: 0 },
      { name: 'band2khz', value: 1 },
    ],
    presets: ['Flat', 'Rock'],
    roomFit: true,
  },
  quality: { sampleRate: 48_000, bitDepth: 16, bitRate: 1411 },
  updatedAt: 1_000,
  online: true,
  lastSeen: 1_000,
  errors: 0,
  upnp: { state: 'subscribed', lastEventAt: 1_000, events: 4, misses: 0 },
  link: { snr: 35, noise: -91, freqMhz: 5260, rateMbps: 433 },
  diagnostics: null,
  findings: [],
  guides: [],
  samples: [],
  events: [],
  ...overrides,
})

describe('optimisticFor', () => {
  it('paints the transport state the button implies', () => {
    expect(optimisticFor(device(), { action: 'play' })).toEqual({ status: 'play' })
    expect(optimisticFor(device(), { action: 'pause' })).toEqual({ status: 'pause' })
    expect(optimisticFor(device(), { action: 'stop' })).toEqual({ status: 'stop' })
    expect(optimisticFor(device(), { action: 'toggle' })).toEqual({ status: 'play' })
    expect(optimisticFor(device({ status: 'play' }), { action: 'toggle' })).toEqual({
      status: 'pause',
    })
  })

  it('restarts the position on a track change', () => {
    expect(optimisticFor(device(), { action: 'next' })).toEqual({ status: 'load', curposMs: 0 })
    expect(optimisticFor(device(), { action: 'prev' })).toEqual({ status: 'load', curposMs: 0 })
  })

  it('never seeks past the end of a track the device measured', () => {
    expect(optimisticFor(device(), { action: 'seek', seconds: 30 })).toEqual({ curposMs: 30_000 })
    // Seconds in, milliseconds out: the device takes seconds for a seek.
    expect(optimisticFor(device(), { action: 'seek', seconds: 300 })).toEqual({
      curposMs: 120_000,
    })
  })

  it('lets a seek through when no duration is known', () => {
    // A live stream reports no duration: clamping against a missing ceiling
    // would pin the thumb to zero.
    expect(optimisticFor(device({ totalMs: null }), { action: 'seek', seconds: 90 })).toEqual({
      curposMs: 90_000,
    })
    expect(optimisticFor(device({ totalMs: 0 }), { action: 'seek', seconds: 90 })).toEqual({
      curposMs: 90_000,
    })
  })

  it('unmutes a volume write, because a user asking for sound expects sound', () => {
    expect(optimisticFor(device({ mute: true }), { action: 'volume', level: 55 })).toEqual({
      volume: 55,
      mute: false,
    })
  })

  it('paints the scalar settings one at a time', () => {
    expect(optimisticFor(device(), { action: 'mute', muted: true })).toEqual({ mute: true })
    expect(optimisticFor(device(), { action: 'source', input: 'optical' })).toEqual({
      input: 'optical',
    })
    expect(optimisticFor(device(), { action: 'sleep', seconds: 1800 })).toEqual({
      sleepSeconds: 1800,
    })
    expect(optimisticFor(device(), { action: 'output', hardware: 1 })).toEqual({
      outputHardware: 1,
    })
  })

  it('paints the equalizer flag and the preset name without inventing a curve', () => {
    expect(optimisticFor(device(), { action: 'eq', enabled: true })).toEqual({
      eq: { enabled: true },
    })
    expect(optimisticFor(device(), { action: 'eqPreset', name: 'Jazz' })).toEqual({
      eq: { name: 'Jazz' },
    })
  })

  it('moves one band and drops the factory name', () => {
    expect(optimisticFor(device(), { action: 'eqBand', band: 'band2khz', value: 4 })).toEqual({
      eq: {
        bands: [
          { name: 'band1khz', value: 0 },
          { name: 'band2khz', value: 4 },
        ],
        name: '',
      },
    })
  })

  it('paints nothing for an action the view already reads through the poll', () => {
    // Presets, name, LED, balance, URL: nothing to show before the answer lands.
    for (const action of [
      { action: 'preset', slot: 1 },
      { action: 'rename', name: 'Den' },
      { action: 'led', on: true },
      { action: 'buttons', on: false },
      { action: 'balance', value: 0.5 },
      { action: 'maxVolume', level: 80 },
      { action: 'fade', on: true },
      { action: 'url', url: 'https://example.test/a.mp3' },
    ] as const) {
      expect(optimisticFor(device(), action)).toEqual({})
    }
  })
})

describe('withOverride', () => {
  it('shows the painted value while the window is open', () => {
    const painted = { value: { volume: 55 }, at: 1_000 }
    expect(withOverride(device(), painted, 1_000 + overrideLifetimeMs - 1).volume).toBe(55)
  })

  it('shows the device reading again once the window closed', () => {
    const painted = { value: { volume: 55 }, at: 1_000 }
    expect(withOverride(device(), painted, 1_000 + overrideLifetimeMs).volume).toBe(40)
    expect(withOverride(device(), null, 1_000).volume).toBe(40)
  })

  it('returns the same object when there is nothing to paint', () => {
    const current = device()
    expect(withOverride(current, null, 5_000)).toBe(current)
  })

  it('merges the equalizer instead of replacing it', () => {
    // A painted flag must not wipe the curve, and a painted curve must not wipe
    // the flags: `eq` is nested, unlike every other painted field.
    const current = device()
    const flag = withOverride(current, { value: { eq: { enabled: true } }, at: 0 }, 0)
    expect(flag.eq.enabled).toBe(true)
    expect(flag.eq.bands).toEqual(current.eq.bands)
    expect(flag.eq.name).toBe('Rock')
    expect(flag.eq.presets).toEqual(['Flat', 'Rock'])

    const bands = withOverride(
      current,
      { value: { eq: { bands: [{ name: 'band1khz', value: 3 }] } }, at: 0 },
      0
    )
    expect(bands.eq.bands).toEqual([{ name: 'band1khz', value: 3 }])
    expect(bands.eq.name).toBe('Rock')
    expect(bands.eq.enabled).toBe(false)
    expect(bands.eq.presets).toEqual(['Flat', 'Rock'])
  })

  it('leaves the equalizer alone when the action does not touch it', () => {
    const current = device()
    const painted = withOverride(current, { value: { volume: 70 }, at: 0 }, 0)
    expect(painted.eq).toBe(current.eq)
    expect(painted.volume).toBe(70)
    // The rest of the device payload is carried through untouched.
    expect(painted.ip).toBe('192.0.2.150')
    expect(painted.updatedAt).toBe(1_000)
  })
})
