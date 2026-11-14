import { describe, expect, test } from 'vitest'
import {
  groupActionFor,
  groupAnchor,
  groupCeiling,
  groupFailure,
  joinTargets,
  scaledGroupLevel,
} from './group'
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
  test('answers the one group gesture that is a single write', () => {
    expect(groupActionFor({ action: 'mute', muted: true })).toEqual({ intent: 'mute', muted: true })
  })

  test('leaves every other gesture on the device path, the group volume included', () => {
    // The group volume is a card-level gesture now: it carries the loudest
    // speaker's level and paints every row, so it does not go through the
    // device path of `useControls`.
    for (const action of [
      { action: 'volume', level: 30 },
      { action: 'play' },
      { action: 'next' },
      { action: 'seek', seconds: 30 },
      { action: 'source', input: 'optical' },
    ] as const) {
      expect(groupActionFor(action)).toBeNull()
    }
  })
})

describe('groupAnchor', () => {
  test('answers the loudest speaker the hub still reads, the master included', () => {
    const master = device({ ip: '192.0.2.10', volume: 40 })
    const louder = device({ ip: '192.0.2.20', volume: 60 })
    expect(groupAnchor([master, louder])).toEqual(louder)
    expect(groupAnchor([master])).toEqual(master)
  })

  test('keeps the order of the speakers when two are equal', () => {
    // Ex-aequo: the master carries the gesture, which is the level the card
    // already showed before the first move.
    const master = device({ ip: '192.0.2.10', volume: 40 })
    const same = device({ ip: '192.0.2.20', volume: 40 })
    expect(groupAnchor([master, same])).toEqual(master)
  })

  test('never lets a speaker the hub cannot read carry the gesture', () => {
    const master = device({ ip: '192.0.2.10', volume: 40 })
    const offline = device({ ip: '192.0.2.20', volume: 90, online: false })
    const unread = device({ ip: '192.0.2.30', volume: null })
    expect(groupAnchor([master, offline, unread])).toEqual(master)
    expect(groupAnchor([offline, unread])).toBeNull()
  })
})

describe('scaledGroupLevel', () => {
  test('lands a speaker on its share of the anchor', () => {
    // Living Room 60 carries the gesture: moving the group to 30 leaves Bedroom
    // at 20 (a third of the anchor), which is where the reader had put it.
    expect(scaledGroupLevel(30, 60, 40, 100)).toBe(20)
    expect(scaledGroupLevel(30, 60, 60, 100)).toBe(30)
  })

  test('clamps at the ceiling of that speaker', () => {
    expect(scaledGroupLevel(60, 40, 90, 30)).toBe(30)
  })

  test('falls back to the level itself without a ratio to read', () => {
    expect(scaledGroupLevel(25, null, 40, 100)).toBe(25)
    expect(scaledGroupLevel(25, 0, 40, 100)).toBe(25)
    expect(scaledGroupLevel(25, 40, null, 100)).toBe(25)
    expect(scaledGroupLevel(120, 40, 40, 100)).toBe(100)
  })

  test('leaves a speaker that was at zero where it was put', () => {
    expect(scaledGroupLevel(60, 40, 0, 100)).toBe(0)
  })
})

describe('groupCeiling', () => {
  test('answers the ceiling the device reports, with 100 when it reports none', () => {
    expect(groupCeiling(device({ maxVolume: 80 }))).toBe(80)
    expect(groupCeiling(device({ maxVolume: null }))).toBe(100)
    expect(groupCeiling(device({ maxVolume: 0 }))).toBe(100)
  })
})

describe('groupFailure', () => {
  test('answers null when every write landed', () => {
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

  test('names the command and keeps the body of the first refusal', () => {
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

  test('falls back to the command when the device said nothing', () => {
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

  test('offers the speakers a join could name, never itself', () => {
    expect(joinTargets([self, master, follower, silent, offline], self)).toEqual([master])
  })
})
