// A member of a multiroom group answers almost nothing about its group: the
// registry lives on the master, its own status says `group 1`, and its transport
// is stopped because the stream runs on the master. These tests pin the join the
// hub makes from its own fleet, the answers it prefers over the others, and the
// cases where it declines to make one.
import { describe, expect, test } from 'vitest'
import type { DeviceState } from './device/index.ts'
import { createGroupReconciler, groupGraceMs } from './groups.ts'

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

// The master on a poll that answered nothing: no list, no role, which is what
// this firmware does for one poll now and then while it streams.
const silentMaster = (overrides: Partial<DeviceState> = {}): DeviceState =>
  master({
    group: { role: 'none', name: '', members: [], saved: false, parent: null },
    ...overrides,
  })

// The member as it answers: no name, no member, no track, transport stopped, and
// the address of the master it follows, which this build publishes itself.
const member = (overrides: Partial<DeviceState> = {}): DeviceState =>
  device({
    ip: '192.0.2.151',
    name: 'Cuisine',
    model: 'Muzo Mini',
    group: {
      role: 'member',
      name: '',
      members: [],
      saved: false,
      parent: { name: '', ip: '192.0.2.150' },
    },
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

// A member whose build does not publish `master_ip`: the master's slave list is
// then the only lead, and the one the grace window has to carry.
const silentMember = (overrides: Partial<DeviceState> = {}): DeviceState =>
  member({
    group: { role: 'member', name: '', members: [], saved: false, parent: null },
    ...overrides,
  })

describe('group reconciler', () => {
  test('names the group a member belongs to, and mirrors what the master plays', () => {
    const reconcile = createGroupReconciler()
    const salon = master()
    const cuisine = member()
    reconcile([salon, cuisine], 1_000)

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

  test('leaves the member own fields alone: the mirror is a copy, not a rewrite', () => {
    const reconcile = createGroupReconciler()
    const cuisine = member()
    reconcile([master(), cuisine], 1_000)

    expect(cuisine.status).toBe('stop')
    expect(cuisine.title).toBe('')
    expect(cuisine.mode).toBe('99')
    expect(cuisine.group.role).toBe('member')
  })

  test('finds the master by name when a saved group carries no address', () => {
    const reconcile = createGroupReconciler()
    const salon = master({
      group: {
        role: 'master',
        name: 'Appart',
        members: [{ name: 'Cuisine', ip: '', uuid: 'FF9700' }],
        saved: true,
        parent: null,
      },
    })
    const cuisine = silentMember()
    reconcile([salon, cuisine], 1_000)

    expect(cuisine.group.parent).toEqual({ name: 'Salon', ip: '192.0.2.150' })
  })

  test('does not attach a member to a master that lists another address', () => {
    // A name is only a key when the registry has no address: a speaker that
    // moved lease keeps the name the app shows, and the two must not collide.
    const reconcile = createGroupReconciler()
    const salon = master({
      group: {
        role: 'master',
        name: 'Appart',
        members: [{ name: 'Cuisine', ip: '192.0.2.99', uuid: 'FF9700' }],
        saved: true,
        parent: null,
      },
    })
    const cuisine = silentMember()
    reconcile([salon, cuisine], 1_000)

    expect(cuisine.group.parent).toBeNull()
    expect(cuisine.mirror).toBeNull()
  })

  test('says nothing about a group whose master is not in the fleet or offline', () => {
    const reconcile = createGroupReconciler()
    const alone = silentMember()
    reconcile([alone], 1_000)
    expect(alone.group.name).toBe('')
    expect(alone.mirror).toBeNull()

    const offlineMaster = master({ online: false })
    const other = silentMember()
    reconcile([offlineMaster, other], 2_000)
    expect(other.group.parent).toBeNull()
  })

  test('does not mirror over a member that plays a stream of its own', () => {
    const reconcile = createGroupReconciler()
    const cuisine = member({ status: 'play', title: 'Local', curposMs: 1_000 })
    reconcile([master(), cuisine], 1_000)

    // The group is still named: membership is not in doubt, only the mirror is.
    expect(cuisine.group.name).toBe('Appart')
    expect(cuisine.mirror).toBeNull()
    expect(cuisine.title).toBe('Local')
  })

  test('keeps a name and a member list the member answered itself', () => {
    const reconcile = createGroupReconciler()
    const cuisine = member({
      group: {
        role: 'member',
        name: 'Cuisine',
        members: [{ name: 'Salon', ip: '192.0.2.150', uuid: 'AA' }],
        saved: false,
        parent: { name: '', ip: '192.0.2.150' },
      },
    })
    reconcile([master(), cuisine], 1_000)

    expect(cuisine.group.name).toBe('Cuisine')
    expect(cuisine.group.members).toEqual([{ name: 'Salon', ip: '192.0.2.150', uuid: 'AA' }])
    expect(cuisine.group.parent).toEqual({ name: 'Salon', ip: '192.0.2.150' })
  })

  test('leaves the master as it answered, and drops a stale mirror', () => {
    const reconcile = createGroupReconciler()
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
    reconcile([salon], 1_000)

    expect(salon.mirror).toBeNull()
    expect(salon.group.name).toBe('Appart')
    expect(salon.group.parent).toBeNull()
  })

  test('mirrors nothing while the master is not playing', () => {
    const reconcile = createGroupReconciler()
    const cuisine = member()
    reconcile([master({ status: 'stop', title: '' }), cuisine], 1_000)

    expect(cuisine.group.parent).not.toBeNull()
    expect(cuisine.mirror).toBeNull()
  })

  test('parents a member from the master it names, even when the master lists nothing', () => {
    // The measured flicker: the master answers an empty slave list for a poll
    // now and then while it streams. The member names its own master at every
    // poll, and that answer is worth more than the master's silence.
    const reconcile = createGroupReconciler()
    const cuisine = member()
    const silent = silentMaster()
    reconcile([silent, cuisine], 1_000)

    expect(cuisine.group.parent).toEqual({ name: 'Salon', ip: '192.0.2.150' })
    expect(cuisine.mirror).not.toBeNull()
  })

  test('holds the master role over a poll that answers an empty list', () => {
    const reconcile = createGroupReconciler()
    const first = silentMember()
    reconcile([master(), first], 1_000)
    expect(first.group.parent).toEqual({ name: 'Salon', ip: '192.0.2.150' })

    // One hollow poll, two seconds later: the group is still the group. The
    // member is a fresh answer, the way the poll loop serves one every tick.
    const silent = silentMaster()
    const second = silentMember()
    reconcile([silent, second], 3_000)
    expect(silent.group.role).toBe('master')
    expect(silent.group.members).toEqual([{ name: 'Cuisine', ip: '192.0.2.151', uuid: 'FF9700' }])
    expect(second.group.parent).toEqual({ name: 'Salon', ip: '192.0.2.150' })
    expect(second.mirror).not.toBeNull()
  })

  test('gives up the group once the master stays silent past the window', () => {
    const reconcile = createGroupReconciler()
    const first = silentMember()
    reconcile([master(), first], 1_000)

    const silent = silentMaster()
    const second = silentMember()
    reconcile([silent, second], 1_000 + groupGraceMs)
    expect(silent.group.role).toBe('none')
    expect(second.group.parent).toBeNull()
    expect(second.mirror).toBeNull()
  })

  test('keeps the address a member names when the fleet does not poll it', () => {
    // Nothing to copy, so no mirror: the hub does not invent a playback from a
    // speaker it never read.
    const reconcile = createGroupReconciler()
    const cuisine = member({
      group: {
        role: 'member',
        name: '',
        members: [],
        saved: false,
        parent: { name: '', ip: '192.0.2.99' },
      },
    })
    reconcile([cuisine], 1_000)

    expect(cuisine.group.parent).toEqual({ name: '', ip: '192.0.2.99' })
    expect(cuisine.mirror).toBeNull()
  })

  test('drops the hold as soon as the member stops being one', () => {
    const reconcile = createGroupReconciler()
    const first = silentMember()
    reconcile([master(), first], 1_000)
    expect(first.group.parent).not.toBeNull()

    // The group is gone on the device side (`group: 0`), so the fleet forgets it
    // at once instead of serving a membership nobody reports any more.
    const left = silentMember({
      group: { role: 'none', name: '', members: [], saved: false, parent: null },
    })
    reconcile([master(), left], 2_000)
    expect(left.group.parent).toBeNull()

    // Back as a member while the master answers nothing, past the window: nothing
    // confirms the group, and the fleet does not resurrect the record it dropped.
    const back = silentMember()
    reconcile([silentMaster(), back], 2_000 + groupGraceMs)
    expect(back.group.parent).toBeNull()
  })
})
