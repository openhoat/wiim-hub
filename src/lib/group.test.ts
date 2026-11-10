import { describe, expect, it } from 'vitest'
import { groupActionFor, groupFailure, joinTargets } from './group'
import type { Device } from './types'

const device = (overrides: Partial<Device> = {}): Device => ({
  ip: '192.0.2.10',
  name: 'Living Room',
  model: 'WiiM Pro',
  firmware: 'Linkplay.4.8',
  release: '20261027',
  ssid: 'lab',
  bssid: 'aa:bb:cc:dd:ee:ff',
  wmrmVersion: '4.3',
  uuid: 'A1B2C3D4E5F60718293A4B5C',
  mirror: null,
  group: { role: 'none', name: '', members: [], saved: false, parent: null },
  rssi: -53,
  volume: 40,
  status: 'play',
  title: '',
  artist: '',
  album: '',
  albumArt: '',
  curposMs: 0,
  totalMs: 0,
  source: 'wifi',
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
  findings: [],
  guides: [],
  ...overrides,
})

describe('groupActionFor', () => {
  it('turns the card gestures into the group ones', () => {
    expect(groupActionFor({ action: 'volume', level: 30 })).toEqual({ intent: 'volume', level: 30 })
    expect(groupActionFor({ action: 'mute', muted: true })).toEqual({ intent: 'mute', muted: true })
  })

  it('leaves every other gesture on the device path', () => {
    for (const action of [
      { action: 'play' },
      { action: 'next' },
      { action: 'seek', seconds: 30 },
      { action: 'source', input: 'optical' },
    ] as const) {
      expect(groupActionFor(action)).toBeNull()
    }
  })
})

describe('groupFailure', () => {
  it('answers null when every write landed', () => {
    expect(groupFailure([])).toBeNull()
    expect(
      groupFailure([
        { ok: true, unsupported: false, command: 'setPlayerCmd:vol:30', body: 'OK' },
        {
          ok: true,
          unsupported: false,
          command: 'multiroom:SlaveVolume:192.0.2.20:30',
          body: 'OK',
        },
      ])
    ).toBeNull()
  })

  it('names the command and keeps the body of the first refusal', () => {
    // A member that refused is the interesting case: the master said OK.
    expect(
      groupFailure([
        { ok: true, unsupported: false, command: 'setPlayerCmd:vol:30', body: 'OK' },
        {
          ok: false,
          unsupported: true,
          command: 'multiroom:SlaveVolume:192.0.2.20:30',
          body: 'unknown command',
        },
      ])
    ).toBe('multiroom:SlaveVolume:192.0.2.20:30: unknown command')
  })

  it('falls back to the command when the device said nothing', () => {
    expect(
      groupFailure([{ ok: false, unsupported: false, command: 'multiroom:Ungroup', body: '' }])
    ).toBe('multiroom:Ungroup')
  })
})

describe('joinTargets', () => {
  const self = device({ ip: '192.0.2.30', name: 'Kitchen' })
  const master = device({
    ip: '192.0.2.10',
    group: { role: 'master', name: '', members: [], saved: false, parent: null },
  })
  const follower = device({
    ip: '192.0.2.20',
    group: {
      role: 'member',
      name: '',
      members: [],
      saved: false,
      parent: { name: 'Living Room', ip: '192.0.2.10' },
    },
  })
  const silent = device({ ip: '192.0.2.40', uuid: '' })
  const offline = device({ ip: '192.0.2.50', online: false })

  it('offers the speakers a join could name, never itself', () => {
    expect(joinTargets([self, master, follower, silent, offline], self)).toEqual([master])
  })
})
