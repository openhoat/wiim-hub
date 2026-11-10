// A member of a multiroom group answers almost nothing about its group: the
// registry lives on the master, its own status says `group 1`, and its transport
// is stopped because the stream runs on the master. These tests pin the join the
// hub makes from its own fleet, and the cases where it declines to make one.
import { describe, expect, it } from 'vitest'
import type { DeviceState } from './device/index.ts'
import { reconcileGroups } from './groups.ts'

const device = (overrides: Partial<DeviceState> = {}): DeviceState => ({
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

// The master as it answers once its group runs: the registry names the group and
// the slave list carries the member's address.
const master = (overrides: Partial<DeviceState> = {}): DeviceState =>
  device({
    ip: '192.0.2.150',
    name: 'Salon',
    group: {
      role: 'master',
      name: 'Appart',
      members: [{ name: 'Cuisine', ip: '192.0.2.151', uuid: 'FF9700' }],
      saved: true,
      parent: null,
    },
    ...overrides,
  })

// The member as it answers: no name, no member, no track, transport stopped.
const member = (overrides: Partial<DeviceState> = {}): DeviceState =>
  device({
    ip: '192.0.2.151',
    name: 'Cuisine',
    model: 'Muzo Mini',
    group: { role: 'member', name: '', members: [], saved: false, parent: null },
    status: 'stop',
    title: '',
    artist: '',
    album: '',
    albumArt: '',
    curposMs: 0,
    totalMs: 0,
    source: '',
    mode: '99',
    input: '',
    ...overrides,
  })

describe('reconcileGroups', () => {
  it('names the group a member belongs to, and mirrors what the master plays', () => {
    const salon = master()
    const cuisine = member()
    reconcileGroups([salon, cuisine])

    expect(cuisine.group.name).toBe('Appart')
    expect(cuisine.group.members).toEqual([{ name: 'Cuisine', ip: '192.0.2.151', uuid: 'FF9700' }])
    expect(cuisine.group.parent).toEqual({ name: 'Salon', ip: '192.0.2.150' })
    expect(cuisine.mirror).toEqual({
      from: { name: 'Salon', ip: '192.0.2.150' },
      group: 'Appart',
      status: 'play',
      title: 'Track',
      artist: 'Artist',
      album: 'Album',
      albumArt: 'art://cover',
      curposMs: 30_000,
      totalMs: 200_000,
      source: 'YouTubeMusic',
      updatedAt: 7,
    })
  })

  it('leaves the member own fields alone: the mirror is a copy, not a rewrite', () => {
    const cuisine = member()
    reconcileGroups([master(), cuisine])

    expect(cuisine.status).toBe('stop')
    expect(cuisine.title).toBe('')
    expect(cuisine.mode).toBe('99')
    expect(cuisine.group.role).toBe('member')
  })

  it('finds the master by name when a saved group carries no address', () => {
    const salon = master({
      group: {
        role: 'master',
        name: 'Appart',
        members: [{ name: 'Cuisine', ip: '', uuid: 'FF9700' }],
        saved: true,
        parent: null,
      },
    })
    const cuisine = member()
    reconcileGroups([salon, cuisine])

    expect(cuisine.group.parent).toEqual({ name: 'Salon', ip: '192.0.2.150' })
  })

  it('does not attach a member to a master that lists another address', () => {
    // A name is only a key when the registry has no address: a speaker that
    // moved lease keeps the name the app shows, and the two must not collide.
    const salon = master({
      group: {
        role: 'master',
        name: 'Appart',
        members: [{ name: 'Cuisine', ip: '192.0.2.99', uuid: 'FF9700' }],
        saved: true,
        parent: null,
      },
    })
    const cuisine = member()
    reconcileGroups([salon, cuisine])

    expect(cuisine.group.parent).toBeNull()
    expect(cuisine.mirror).toBeNull()
  })

  it('says nothing about a group whose master is not in the fleet or offline', () => {
    const alone = member()
    reconcileGroups([alone])
    expect(alone.group.name).toBe('')
    expect(alone.mirror).toBeNull()

    const offlineMaster = master({ online: false })
    const other = member()
    reconcileGroups([offlineMaster, other])
    expect(other.group.parent).toBeNull()
  })

  it('does not mirror over a member that plays a stream of its own', () => {
    const cuisine = member({ status: 'play', title: 'Local', curposMs: 1_000 })
    reconcileGroups([master(), cuisine])

    // The group is still named: membership is not in doubt, only the mirror is.
    expect(cuisine.group.name).toBe('Appart')
    expect(cuisine.mirror).toBeNull()
    expect(cuisine.title).toBe('Local')
  })

  it('keeps a name and a member list the member answered itself', () => {
    const cuisine = member({
      group: {
        role: 'member',
        name: 'Cuisine',
        members: [{ name: 'Salon', ip: '192.0.2.150', uuid: 'AA' }],
        saved: false,
        parent: null,
      },
    })
    reconcileGroups([master(), cuisine])

    expect(cuisine.group.name).toBe('Cuisine')
    expect(cuisine.group.members).toEqual([{ name: 'Salon', ip: '192.0.2.150', uuid: 'AA' }])
    expect(cuisine.group.parent).toEqual({ name: 'Salon', ip: '192.0.2.150' })
  })

  it('leaves the master as it answered, and drops a stale mirror', () => {
    const salon = master({
      mirror: {
        from: { name: 'x', ip: 'y' },
        group: '',
        status: 'play',
        title: '',
        artist: '',
        album: '',
        albumArt: '',
        curposMs: null,
        totalMs: null,
        source: '',
        updatedAt: null,
      },
    })
    reconcileGroups([salon])

    expect(salon.mirror).toBeNull()
    expect(salon.group.name).toBe('Appart')
    expect(salon.group.parent).toBeNull()
  })

  it('mirrors nothing while the master is not playing', () => {
    const cuisine = member()
    reconcileGroups([master({ status: 'stop', title: '' }), cuisine])

    expect(cuisine.group.parent).not.toBeNull()
    expect(cuisine.mirror).toBeNull()
  })
})
