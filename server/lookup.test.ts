// The routes address a device by the key it is polled under, by its address, or
// by the name it reports. The name is the one a person types, so these tests pin
// when it is accepted, and the two cases where the hub declines it: a name two
// speakers share, and an address that resolves to nobody.
import { describe, expect, it } from 'vitest'
import type { DeviceState } from './device/index.ts'
import { findDevice } from './lookup.ts'

const device = (overrides: Partial<DeviceState> = {}): DeviceState => ({
  ip: '192.0.2.10',
  name: 'Living Room',
  model: 'WiiM Pro',
  firmware: 'Linkplay.4.8',
  release: '20261027',
  ssid: 'lab',
  bssid: 'aa:bb:cc:dd:ee:ff',
  wmrmVersion: '4.3',
  mirror: null,
  group: { role: 'none', name: '', members: [], saved: false, parent: null },
  rssi: -53,
  volume: 30,
  status: 'play',
  title: 'Track',
  artist: 'Artist',
  album: 'Album',
  albumArt: 'art://cover',
  curposMs: 30_000,
  totalMs: 200_000,
  source: 'YouTubeMusic',
  mode: '10',
  input: 'wifi',
  maxVolume: 100,
  mute: false,
  sleepSeconds: 0,
  inputs: ['wifi'],
  inputLabels: { wifi: 'Wi-Fi' },
  outputs: [],
  outputHardware: null,
  presets: [],
  eq: { enabled: false, name: '', source: '', bands: [], presets: [], roomFit: false },
  quality: { sampleRate: 48000, bitDepth: 16, bitRate: 128 },
  updatedAt: 7,
  online: true,
  lastSeen: 7,
  errors: 0,
  upnp: { state: 'off', lastEventAt: null, events: 0, misses: 0 },
  link: { snr: 35, noise: -91, freqMhz: 5260, rateMbps: 433 },
  diagnostics: null,
  samples: [],
  events: [],
  ...overrides,
})

const states = (entries: DeviceState[]): Map<string, DeviceState> =>
  new Map(entries.map(state => [state.ip, state]))

describe('findDevice', () => {
  it('answers the key it was given when that key is polled', () => {
    const kitchen = device({ ip: '192.0.2.11', name: 'Kitchen' })
    const entry = findDevice(states([kitchen]), '192.0.2.11')
    expect(entry).toEqual({ key: '192.0.2.11', state: kitchen })
  })

  it('answers a device by the address it currently answers on', () => {
    // The key is the address it was configured with; the device has moved since.
    const kitchen = device({ ip: '192.0.2.11', name: 'Kitchen' })
    const entry = findDevice(new Map([['kitchen.local', kitchen]]), '192.0.2.11')
    expect(entry).toEqual({ key: 'kitchen.local', state: kitchen })
  })

  it('answers a device by the name it reports', () => {
    const kitchen = device({ ip: '192.0.2.11', name: 'Kitchen' })
    const entry = findDevice(states([device(), kitchen]), 'Kitchen')
    expect(entry).toEqual({ key: '192.0.2.11', state: kitchen })
  })

  it('refuses a name two speakers share, and asks for an address instead', () => {
    // Two units of the same model out of the box report the same name: picking
    // one would send a command to a machine the caller did not mean.
    const left = device({ ip: '192.0.2.20', name: 'WiiM Mini' })
    const right = device({ ip: '192.0.2.21', name: 'WiiM Mini' })
    expect(findDevice(states([left, right]), 'WiiM Mini')).toBeNull()
    expect(findDevice(states([left, right]), '192.0.2.21')).toEqual({
      key: '192.0.2.21',
      state: right,
    })
  })

  it('refuses an empty host rather than answering the first device', () => {
    const unnamed = device({ name: '' })
    expect(findDevice(states([unnamed]), '')).toBeNull()
  })

  it('answers nothing for a name no device carries', () => {
    expect(findDevice(states([device()]), 'Garage')).toBeNull()
  })
})
