// The group writes, pinned against the measurements in `docs/feature-research.md`
// §5.8.1: there is no group volume (the master's own volume moves alone), there
// is a group mute (the master's mute propagates), and a join names the master's
// uuid on the guest. These tests hold those three shapes, and the refusals that
// keep the hub from sending a command the device would accept while doing
// nothing.
import { describe, expect, test } from 'vitest'
import type { DeviceState } from './device/index.ts'
import type { GroupMember } from './device/multiroom.ts'
import { type FleetUnit, groupPlanFor, parseGroupIntent } from './group-commands.ts'

const member = (name: string, ip: string): GroupMember => ({
  name,
  ip,
  uuid: `${name.toUpperCase()}0000000000000000000`,
})

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
  ...overrides,
})

const master = (members: GroupMember[] = [member('Bedroom', '192.0.2.20')]): FleetUnit => ({
  key: '192.0.2.10',
  state: device({
    group: { role: 'master', name: '', members, saved: false, parent: null },
  }),
})

const follower = (): FleetUnit => ({
  key: '192.0.2.20',
  state: device({
    ip: '192.0.2.20',
    name: 'Bedroom',
    uuid: 'BED000000000000000000000',
    group: {
      role: 'member',
      name: '',
      members: [],
      saved: false,
      parent: { name: 'Living Room', ip: '192.0.2.10' },
    },
  }),
})

const standalone = (): FleetUnit => ({
  key: '192.0.2.30',
  state: device({ ip: '192.0.2.30', name: 'Kitchen', uuid: 'KITCHEN00000000000000000' }),
})

const fleet = (): FleetUnit[] => [master(), follower(), standalone()]

describe('parseGroupIntent', () => {
  test('reads every intent the route accepts', () => {
    expect(parseGroupIntent({ intent: 'leave' })).toEqual({ intent: { intent: 'leave' } })
    expect(parseGroupIntent({ intent: 'ungroup' })).toEqual({ intent: { intent: 'ungroup' } })
    expect(parseGroupIntent({ intent: 'volume', level: 42 })).toEqual({
      intent: { intent: 'volume', level: 42 },
    })
    expect(parseGroupIntent({ intent: 'mute', muted: true })).toEqual({
      intent: { intent: 'mute', muted: true },
    })
    expect(parseGroupIntent({ intent: 'join', master: '192.0.2.10' })).toEqual({
      intent: { intent: 'join', master: '192.0.2.10' },
    })
  })

  test('refuses a body that is not one of them', () => {
    for (const body of [null, 'volume', [], { intent: 'nope' }, {}, { intent: 42 }]) {
      expect(parseGroupIntent(body)).toHaveProperty('error')
    }
  })

  test('refuses a level or a flag outside its range', () => {
    for (const body of [
      { intent: 'volume', level: -1 },
      { intent: 'volume', level: 101 },
      { intent: 'volume', level: 42.5 },
      { intent: 'volume', level: '42' },
      { intent: 'mute', muted: 'yes' },
      { intent: 'memberVolume', member: '192.0.2.20' },
      { intent: 'kick', member: '' },
      { intent: 'kick', member: ' 192.0.2.20' },
      { intent: 'join', master: null },
    ]) {
      expect(parseGroupIntent(body)).toHaveProperty('error')
    }
  })

  test('does not read an inherited property as an intent', () => {
    expect(parseGroupIntent({ intent: 'toString' })).toHaveProperty('error')
  })
})

describe('groupPlanFor, volume', () => {
  test('fans the level out to the master and to every member', () => {
    const plan = groupPlanFor({ intent: 'volume', level: 35 }, master(), fleet())
    expect(plan).toEqual({
      writes: [
        // The master alone: `setPlayerCmd:vol` does not propagate (measured).
        { key: '192.0.2.10', command: 'setPlayerCmd:vol:35', family: 'volume' },
        {
          key: '192.0.2.10',
          command: 'multiroom:SlaveVolume:192.0.2.20:35',
          family: 'volume:192.0.2.20',
        },
      ],
    })
  })

  test('gives each member its own coalescing family, and skips a member with no address', () => {
    const two = master([member('Bedroom', '192.0.2.20'), member('Saved', '')])
    const plan = groupPlanFor({ intent: 'volume', level: 20 }, two, [two, follower()])
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.writes.map(write => write.family)).toEqual(['volume', 'volume:192.0.2.20'])
  })

  test('scales each member from the level the driver had before the write', () => {
    // Living Room 40, Bedroom 20: half. Moving the group to 30 leaves Bedroom at
    // 15, where the reader had put it, instead of levelling the two rooms.
    const two = master([member('Bedroom', '192.0.2.20')])
    const quiet = follower()
    quiet.state.volume = 20
    expect(groupPlanFor({ intent: 'volume', level: 30 }, two, [two, quiet])).toEqual({
      writes: [
        { key: '192.0.2.10', command: 'setPlayerCmd:vol:30', family: 'volume' },
        {
          key: '192.0.2.10',
          command: 'multiroom:SlaveVolume:192.0.2.20:15',
          family: 'volume:192.0.2.20',
        },
      ],
    })
  })

  test('lands the level as asked when there is no ratio to read', () => {
    // A driver the fleet has read no volume for, or one at zero: the gesture
    // still reaches the members, it just cannot be proportional.
    for (const from of [null, 0]) {
      const unread = master([member('Bedroom', '192.0.2.20')])
      unread.state.volume = from
      const plan = groupPlanFor({ intent: 'volume', level: 25 }, unread, [unread, follower()])
      if ('error' in plan) throw new Error(plan.error)
      expect(plan.writes[1].command).toBe('multiroom:SlaveVolume:192.0.2.20:25')
    }
  })

  test('leaves a member that was at zero where it was put', () => {
    const two = master([member('Bedroom', '192.0.2.20')])
    const silent = follower()
    silent.state.volume = 0
    const plan = groupPlanFor({ intent: 'volume', level: 60 }, two, [two, silent])
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.writes[1].command).toBe('multiroom:SlaveVolume:192.0.2.20:0')
  })

  test('clamps a scaled level at the ceiling of that member', () => {
    // The master asks for 60 and the member follows, but a Mini that stops at
    // 30 gets 30 rather than a value it would refuse.
    const two = master([member('Bedroom', '192.0.2.20')])
    const small = follower()
    small.state.maxVolume = 30
    const plan = groupPlanFor({ intent: 'volume', level: 60 }, two, [two, small])
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.writes[1].command).toBe('multiroom:SlaveVolume:192.0.2.20:30')
  })

  test('refuses a level above the ceiling of the speaker that drives the group', () => {
    const quiet = master([member('Bedroom', '192.0.2.20')])
    quiet.state.maxVolume = 80
    const plan = groupPlanFor({ intent: 'volume', level: 90 }, quiet, [quiet, follower()])
    expect(plan).toEqual({ error: 'volume above the device ceiling (80)' })
  })

  test('refuses on a speaker that drives no group', () => {
    expect(groupPlanFor({ intent: 'volume', level: 30 }, standalone(), fleet())).toEqual({
      error: 'this speaker does not drive a group',
    })
  })
})

describe('groupPlanFor, mute', () => {
  test('writes once on the master, which is what propagates', () => {
    expect(groupPlanFor({ intent: 'mute', muted: true }, master(), fleet())).toEqual({
      writes: [{ key: '192.0.2.10', command: 'setPlayerCmd:mute:1', family: null }],
    })
    expect(groupPlanFor({ intent: 'mute', muted: false }, master(), fleet())).toEqual({
      writes: [{ key: '192.0.2.10', command: 'setPlayerCmd:mute:0', family: null }],
    })
  })
})

describe('groupPlanFor, one member', () => {
  test('addresses a member the master lists', () => {
    expect(
      groupPlanFor({ intent: 'memberVolume', member: '192.0.2.20', level: 25 }, master(), fleet())
    ).toEqual({
      writes: [
        {
          key: '192.0.2.10',
          command: 'multiroom:SlaveVolume:192.0.2.20:25',
          family: 'volume:192.0.2.20',
        },
      ],
    })
    expect(
      groupPlanFor({ intent: 'memberMute', member: '192.0.2.20', muted: true }, master(), fleet())
    ).toEqual({
      writes: [{ key: '192.0.2.10', command: 'multiroom:SlaveMute:192.0.2.20:1', family: null }],
    })
  })

  test('refuses a member the master does not list', () => {
    // A page rendered before the group changed sends an address that is gone.
    expect(
      groupPlanFor({ intent: 'memberVolume', member: '192.0.2.99', level: 25 }, master(), fleet())
    ).toEqual({ error: 'unknown group member: 192.0.2.99' })
  })

  test('refuses a level above the ceiling of that member', () => {
    const quiet = follower()
    quiet.state.maxVolume = 50
    expect(
      groupPlanFor({ intent: 'memberVolume', member: '192.0.2.20', level: 60 }, master(), [
        master(),
        quiet,
      ])
    ).toEqual({ error: 'volume above the device ceiling (50)' })
  })
})

describe('groupPlanFor, membership', () => {
  test('sends the join to the guest, naming the master and its uuid', () => {
    const plan = groupPlanFor({ intent: 'join', master: '192.0.2.10' }, standalone(), fleet())
    expect(plan).toEqual({
      writes: [
        {
          key: '192.0.2.30',
          command: 'multiroom:JoinGroup:IP=192.0.2.10:uuid=A1B2C3D4E5F60718293A4B5C',
          family: null,
        },
      ],
    })
  })

  test('refuses a join the device would accept while grouping nothing', () => {
    // Each case is written out: a table keyed on a fleet that already contains
    // the unit it claims is unknown pins nothing but its own mistake.
    const noUuid = master()
    noUuid.state.uuid = ''
    const offline = master()
    offline.state.online = false
    const nested = master()
    nested.state.group.role = 'member'

    expect(groupPlanFor({ intent: 'join', master: '192.0.2.30' }, standalone(), fleet())).toEqual({
      error: 'a speaker cannot join itself',
    })
    expect(groupPlanFor({ intent: 'join', master: '192.0.2.10' }, follower(), fleet())).toEqual({
      error: 'already a member of this group',
    })
    expect(groupPlanFor({ intent: 'join', master: '192.0.2.30' }, follower(), fleet())).toEqual({
      error: 'this speaker already follows another group',
    })
    expect(groupPlanFor({ intent: 'join', master: '192.0.2.99' }, standalone(), fleet())).toEqual({
      error: 'unknown group master: 192.0.2.99',
    })
    expect(
      groupPlanFor({ intent: 'join', master: '192.0.2.10' }, standalone(), [standalone(), offline])
    ).toEqual({ error: 'the group master is offline' })
    expect(
      groupPlanFor({ intent: 'join', master: '192.0.2.10' }, standalone(), [standalone(), nested])
    ).toEqual({ error: 'this speaker follows a group of its own' })
    expect(
      groupPlanFor({ intent: 'join', master: '192.0.2.10' }, standalone(), [standalone(), noUuid])
    ).toEqual({ error: 'the group master published no uuid' })
    const gone = standalone()
    gone.state.online = false
    expect(groupPlanFor({ intent: 'join', master: '192.0.2.10' }, gone, [gone, master()])).toEqual({
      error: 'device offline',
    })
  })

  test('sends the kick and the ungroup to the master', () => {
    expect(groupPlanFor({ intent: 'kick', member: '192.0.2.20' }, master(), fleet())).toEqual({
      writes: [{ key: '192.0.2.10', command: 'multiroom:SlaveKickout:192.0.2.20', family: null }],
    })
    expect(groupPlanFor({ intent: 'ungroup' }, master(), fleet())).toEqual({
      writes: [{ key: '192.0.2.10', command: 'multiroom:Ungroup', family: null }],
    })
  })

  test('sends the leave to the member, and only from a member', () => {
    expect(groupPlanFor({ intent: 'leave' }, follower(), fleet())).toEqual({
      writes: [{ key: '192.0.2.20', command: 'multiroom:LeaveGroup', family: null }],
    })
    expect(groupPlanFor({ intent: 'leave' }, master(), fleet())).toEqual({
      error: 'this speaker follows no group',
    })
  })

  test('refuses a kick on a member the master does not list', () => {
    expect(groupPlanFor({ intent: 'kick', member: '192.0.2.99' }, master(), fleet())).toEqual({
      error: 'unknown group member: 192.0.2.99',
    })
  })
})
