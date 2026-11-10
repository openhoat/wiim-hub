import { describe, expect, it } from 'vitest'
import { cardTitle, fleetCards, sameMember } from './cards.ts'
import type { Device, GroupState } from './types'

// A speaker as the hub serves it, minimal: only the group fields and the track
// the partition reads carry a value worth asserting on here.
const device = (ip: string, name: string, overrides: Partial<Device> = {}): Device => ({
  ip,
  name,
  model: 'WiiM Pro',
  firmware: 'Linkplay.4.8.833748',
  release: '20261027',
  ssid: 'HomeNet-5G',
  bssid: '02:00:00:00:00:05',
  wmrmVersion: '4.3',
  mirror: null,
  group: { role: 'none', name: '', members: [], saved: false, parent: null },
  rssi: -51,
  volume: 40,
  status: 'stop',
  title: '',
  artist: '',
  album: '',
  albumArt: '',
  curposMs: null,
  totalMs: null,
  source: '',
  mode: '99',
  input: '',
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

const grouped = (group: Partial<GroupState>): GroupState => ({
  role: 'none',
  name: '',
  members: [],
  saved: false,
  parent: null,
  ...group,
})

const master = (members: GroupState['members'], name = 'Apartment'): Device =>
  device('192.0.2.21', 'Living Room', {
    status: 'play',
    title: 'Late Ferry',
    online: true,
    group: grouped({ role: 'master', name, members }),
  })

const follower = (ip: string, name: string, overrides: Partial<Device> = {}): Device =>
  device(ip, name, {
    ...overrides,
    group: grouped({
      role: 'member',
      name: '',
      parent: { name: 'Living Room', ip: '192.0.2.21' },
    }),
  })

describe('sameMember', () => {
  it('matches on the address the master published', () => {
    const entry = { name: 'Hallway', ip: '192.0.2.23', uuid: 'AB' }
    expect(sameMember(entry, device('192.0.2.23', 'Whatever'))).toBe(true)
    expect(sameMember(entry, device('192.0.2.24', 'Hallway'))).toBe(false)
  })

  it('falls back to the name when the group carries no address', () => {
    const entry = { name: 'Bathroom', ip: '', uuid: 'AB' }
    expect(sameMember(entry, device('192.0.2.99', ' bathroom '))).toBe(true)
    expect(sameMember(entry, device('192.0.2.99', 'Hallway'))).toBe(false)
    expect(sameMember({ name: '', ip: '', uuid: 'AB' }, device('192.0.2.99', ''))).toBe(false)
  })
})

describe('fleetCards', () => {
  it('draws one card per speaker when nothing is grouped', () => {
    const cards = fleetCards([device('192.0.2.21', 'Living Room'), device('192.0.2.22', 'Bedroom')])
    expect(cards.map(card => card.ip)).toEqual(['192.0.2.21', '192.0.2.22'])
    expect(cards.every(card => card.members.length === 0 && card.absent.length === 0)).toBe(true)
  })

  it('folds a confirmed member into the card of the speaker that drives it', () => {
    const cards = fleetCards([
      master([{ name: 'Hallway', ip: '192.0.2.23', uuid: 'AB' }]),
      follower('192.0.2.23', 'Hallway'),
      device('192.0.2.22', 'Bedroom'),
    ])
    expect(cards.map(card => card.ip)).toEqual(['192.0.2.21', '192.0.2.22'])
    expect(cards[0].members.map(member => member.ip)).toEqual(['192.0.2.23'])
    expect(cards[0].absent).toEqual([])
  })

  it('keeps the order the master named, and appends a follower it forgot', () => {
    const cards = fleetCards([
      master([
        { name: 'Hallway', ip: '192.0.2.23', uuid: 'AB' },
        { name: 'Kitchen', ip: '192.0.2.24', uuid: 'CD' },
      ]),
      follower('192.0.2.24', 'Kitchen'),
      follower('192.0.2.23', 'Hallway'),
      follower('192.0.2.25', 'Study'),
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0].members.map(member => member.name)).toEqual(['Hallway', 'Kitchen', 'Study'])
  })

  it('leaves a member that plays its own track on its own card', () => {
    const cards = fleetCards([
      master([{ name: 'Hallway', ip: '192.0.2.23', uuid: 'AB' }]),
      follower('192.0.2.23', 'Hallway', { status: 'play', title: 'Local Radio' }),
    ])
    expect(cards.map(card => card.ip)).toEqual(['192.0.2.21', '192.0.2.23'])
    // It is polled by the fleet, so it is not repeated as a member with no
    // address either.
    expect(cards[0].absent).toEqual([])
  })

  it('gives a member its own card when the master is not in the fleet', () => {
    const cards = fleetCards([follower('192.0.2.23', 'Hallway')])
    expect(cards.map(card => card.ip)).toEqual(['192.0.2.23'])
  })

  it('keeps a member apart when the master stopped answering', () => {
    const cards = fleetCards([
      {
        ...master([{ name: 'Hallway', ip: '192.0.2.23', uuid: 'AB' }]),
        online: false,
      },
      follower('192.0.2.23', 'Hallway'),
    ])
    expect(cards.map(card => card.ip)).toEqual(['192.0.2.21', '192.0.2.23'])
  })

  it('folds a member that stopped answering while the group runs', () => {
    const cards = fleetCards([
      master([{ name: 'Hallway', ip: '192.0.2.23', uuid: 'AB' }]),
      { ...follower('192.0.2.23', 'Hallway'), online: false },
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0].members.map(member => member.name)).toEqual(['Hallway'])
  })

  it('refuses to fold a card into a speaker the fleet does not call a master', () => {
    const cards = fleetCards([
      device('192.0.2.21', 'Living Room', { group: grouped({ role: 'member' }) }),
      follower('192.0.2.23', 'Hallway'),
    ])
    expect(cards.map(card => card.ip)).toEqual(['192.0.2.21', '192.0.2.23'])
  })

  it('keeps a member the master names and the fleet does not poll', () => {
    const cards = fleetCards([master([{ name: 'Bathroom', ip: '', uuid: 'EF' }])])
    expect(cards).toHaveLength(1)
    expect(cards[0].members).toEqual([])
    expect(cards[0].absent).toEqual([{ name: 'Bathroom', ip: '', uuid: 'EF' }])
  })
})

describe('cardTitle', () => {
  it('announces the group a speaker drives', () => {
    const cards = fleetCards([
      master([{ name: 'Hallway', ip: '192.0.2.23', uuid: 'AB' }]),
      follower('192.0.2.23', 'Hallway'),
    ])
    expect(cardTitle(cards[0])).toBe('Apartment')
  })

  it('falls back to the speaker name when the group has no name or no member', () => {
    const unnamed = fleetCards([
      master([{ name: 'Hallway', ip: '192.0.2.23', uuid: 'AB' }], ''),
      follower('192.0.2.23', 'Hallway'),
    ])
    expect(cardTitle(unnamed[0])).toBe('Living Room')
    const alone = fleetCards([device('192.0.2.22', 'Bedroom')])
    expect(cardTitle(alone[0])).toBe('Bedroom')
  })
})
