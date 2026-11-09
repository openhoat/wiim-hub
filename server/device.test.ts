import { describe, expect, it } from 'vitest'
import {
  isExternalInput,
  parseAcoustic,
  parseCapability,
  parseDevice,
  parseGroup,
  parsePresets,
  parseRegistry,
  positionMs,
} from './device.ts'
import {
  acousticCapability,
  eqBands,
  eqList,
  inputCapability,
  inputEnable,
  metaInfo,
  modeRename,
  outputList,
  outputMode,
  playerStatusEx,
  presetInfo,
  savedGroups,
  shutdown,
  slaveList,
  statusEx,
} from './fixtures/wiim-pro.ts'

type Registry = Parameters<typeof parseGroup>[2]

const registry = (overrides: Partial<Registry> = {}): Registry => ({
  at: 0,
  groups: [],
  current: '',
  ...overrides,
})

describe('parseGroup', () => {
  it('reports no group when the device reports nothing', () => {
    expect(parseGroup(null, '0', registry())).toEqual({
      role: 'none',
      name: '',
      members: [],
      saved: false,
    })
  })

  it('reports a master and its members from the reported slave list', () => {
    const raw = {
      Slave_list: [
        { name: 'Bedroom', ip: '192.0.2.11', uuid: 'uuid-1' },
        { name: 'Kitchen', ip: '192.0.2.12', uuid: 'uuid-2' },
      ],
    }
    expect(parseGroup(raw, '0', registry())).toEqual({
      role: 'master',
      name: '',
      members: [
        { name: 'Bedroom', ip: '192.0.2.11', uuid: 'uuid-1' },
        { name: 'Kitchen', ip: '192.0.2.12', uuid: 'uuid-2' },
      ],
      saved: false,
    })
  })

  it('reads the member list under its three spellings', () => {
    for (const key of ['Slave_list', 'slavelist', 'slave_list']) {
      const parsed = parseGroup({ [key]: [{ name: 'Bedroom', uuid: 'uuid-1' }] }, '0', registry())
      expect(parsed.role).toBe('master')
      expect(parsed.members).toEqual([{ name: 'Bedroom', ip: '', uuid: 'uuid-1' }])
    }
  })

  it('falls back to the uuid when a member has no name', () => {
    const parsed = parseGroup({ Slave_list: [{ uuid: 'uuid-1' }] }, '0', registry())
    expect(parsed.members).toEqual([{ name: 'uuid-1', ip: '', uuid: 'uuid-1' }])
  })

  it('reports a master from the slave count alone', () => {
    expect(parseGroup({ Slaves: '2' }, '0', registry())).toMatchObject({
      role: 'master',
      members: [],
    })
  })

  it('reports a member when its status carries a group id', () => {
    expect(parseGroup(null, 'group-1', registry())).toMatchObject({ role: 'member' })
  })

  it('does not take the zero group id for a membership', () => {
    expect(parseGroup(null, '0', registry())).toMatchObject({ role: 'none' })
  })

  it('exposes the saved group of the registry, with no member online', () => {
    const saved = {
      id: 'group-1',
      name: 'Apartment',
      members: [{ name: 'Bedroom', ip: '', uuid: 'uuid-1' }],
    }
    expect(parseGroup(null, '0', registry({ groups: [saved], current: 'group-1' }))).toEqual({
      role: 'none',
      name: 'Apartment',
      members: [{ name: 'Bedroom', ip: '', uuid: 'uuid-1' }],
      saved: true,
    })
  })

  it('keeps the reported members when the saved group is also running', () => {
    const saved = {
      id: 'group-1',
      name: 'Apartment',
      members: [{ name: 'Kitchen', ip: '', uuid: 'uuid-9' }],
    }
    const parsed = parseGroup(
      { Slave_list: [{ name: 'Bedroom', uuid: 'uuid-1' }] },
      '0',
      registry({ groups: [saved], current: 'group-1' })
    )
    expect(parsed).toEqual({
      role: 'master',
      name: 'Apartment',
      members: [{ name: 'Bedroom', ip: '', uuid: 'uuid-1' }],
      saved: true,
    })
  })

  it('ignores a saved group the device does not point at', () => {
    const saved = { id: 'group-1', name: 'Apartment', members: [] }
    expect(parseGroup(null, '0', registry({ groups: [saved], current: 'group-2' }))).toEqual({
      role: 'none',
      name: '',
      members: [],
      saved: false,
    })
  })

  it('ignores a malformed reported member instead of inventing one', () => {
    const parsed = parseGroup({ Slaves: '2', Slave_list: [null, 'Bedroom', 3] }, '0', registry())
    expect(parsed.role).toBe('master')
    expect(parsed.members).toEqual([])
  })
})

describe('isExternalInput', () => {
  it('treats the analogue and optical inputs as sources without a track', () => {
    expect(isExternalInput('optical')).toBe(true)
    expect(isExternalInput('line-in')).toBe(true)
  })

  it('leaves the network playlist and the unmeasured inputs alone', () => {
    expect(isExternalInput('wifi')).toBe(false)
    expect(isExternalInput('bluetooth')).toBe(false)
    expect(isExternalInput('')).toBe(false)
  })
})

describe('positionMs', () => {
  it('keeps the milliseconds a source below the frontier already reports', () => {
    expect(positionMs(49_489, 'wifi')).toBe(49_489)
  })

  it('reads a position above ten hours as microseconds', () => {
    expect(positionMs(60_000_000, 'wifi')).toBe(60_000)
    expect(positionMs(180_000_000, '')).toBe(180_000)
  })

  it('keeps milliseconds on a known local source, whatever the value', () => {
    // A ten hour audiobook on a key would otherwise read as a few seconds.
    expect(positionMs(36_500_000, 'udisk')).toBe(36_500_000)
    expect(positionMs(45_000_000, 'HDMI')).toBe(45_000_000)
  })

  it('treats the frontier itself as milliseconds', () => {
    expect(positionMs(36_000_000, 'wifi')).toBe(36_000_000)
  })

  it('leaves an absent or zero position alone', () => {
    expect(positionMs(null, 'wifi')).toBeNull()
    expect(positionMs(0, 'wifi')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The parsers, against the answers the reference player actually sent
// (`./fixtures/wiim-pro.ts`). The suites above pin the group bookkeeping alone;
// these pin what the hub does with a whole answer.
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

// `fetchCommand` hands over strings, `parseJson` turns them into records: the
// fixture stays the raw answer, and the test does the same unwrapping.
const json = (raw: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value)) throw new Error(`fixture is not an object: ${raw.slice(0, 40)}`)
  return value
}

const must = <T>(value: T | null): T => {
  if (value === null) throw new Error('fixture did not parse')
  return value
}

type DeviceInput = Parameters<typeof parseDevice>[0]

const recordedCapability = (): DeviceInput['capability'] => ({
  at: 0,
  ...must(
    parseCapability({
      inputs: inputCapability,
      enable: inputEnable,
      rename: modeRename,
      outputs: outputList,
    })
  ),
})

const recordedAcoustic = (): DeviceInput['acoustic'] => ({
  at: 0,
  ...parseAcoustic({ presets: eqList, capability: acousticCapability }, null),
})

const savedRegistry = (): DeviceInput['registry'] => ({
  at: 0,
  groups: [
    {
      id: '11111111-2222-3333-4444-555555555555',
      name: 'Apartment',
      members: [{ name: 'Bedroom', ip: '', uuid: 'A1B2C3D4E5F60718293A4B5C' }],
    },
  ],
  current: '11111111-2222-3333-4444-555555555555',
})

const device = (overrides: Partial<DeviceInput> = {}): DeviceInput => ({
  host: '192.0.2.150',
  ip: '192.0.2.150',
  status: json(statusEx),
  player: json(playerStatusEx),
  meta: json(metaInfo),
  output: json(outputMode),
  sleepRaw: shutdown,
  eqRaw: eqBands,
  slaves: json(slaveList),
  registry: savedRegistry(),
  capability: recordedCapability(),
  presets: [],
  acoustic: recordedAcoustic(),
  ...overrides,
})

describe('parseDevice', () => {
  it('turns the recorded answers into one device patch', () => {
    expect(parseDevice(device())).toEqual({
      ip: '192.0.2.150',
      online: true,
      name: 'Living Room',
      // The model is only ever sent as `project` on this firmware, and the
      // vendor suffix is not part of the name a user reads.
      model: 'WiiM Pro',
      firmware: 'Linkplay.4.8.833748',
      release: '20261027',
      // `essid` is hex on this firmware.
      ssid: 'HomeNet-5G',
      bssid: '02:00:00:00:00:05',
      // The multiroom protocol the group guide checks first.
      wmrmVersion: '4.3',
      group: {
        role: 'none',
        name: 'Apartment',
        members: [{ name: 'Bedroom', ip: '', uuid: 'A1B2C3D4E5F60718293A4B5C' }],
        saved: true,
      },
      rssi: -51,
      volume: 81,
      status: 'stop',
      title: 'Gogol',
      artist: 'Chilly Gonzales',
      album: 'Solo Piano',
      albumArt:
        'https://yt3.googleusercontent.com/QA7o7qaROZVzjlyXtZFX_mp_2Cg_xRgLMnzuSAlrbjS95esjV-8MiF1W52hiins_t-G-uGSwlN0GvHV6=w544-h544-l90-rj',
      curposMs: 49489,
      totalMs: 123000,
      source: 'CAST',
      // Mode 5 is not a source the hub maps: it stays unmapped rather than
      // lighting up the wrong input.
      mode: '5',
      input: '',
      maxVolume: 100,
      mute: false,
      sleepSeconds: 0,
      inputs: ['wifi', 'line-in', 'bluetooth', 'optical'],
      inputLabels: {},
      outputs: [
        { hardware: 1, name: 'Optical Out' },
        { hardware: 2, name: 'Line Out' },
        { hardware: 3, name: 'COAX Out' },
      ],
      outputHardware: 2,
      presets: [],
      eq: {
        enabled: false,
        name: 'Rock',
        source: 'wifi',
        bands: [
          { name: 'band31hz', value: 5 },
          { name: 'band63hz', value: 4 },
          { name: 'band125hz', value: 3 },
          { name: 'band250hz', value: 1.5 },
          { name: 'band500hz', value: -0.5 },
          { name: 'band1khz', value: -1 },
          { name: 'band2khz', value: 0.5 },
          { name: 'band4khz', value: 2.5 },
          { name: 'band8khz', value: 3.5 },
          { name: 'band16khz', value: 1.5 },
        ],
        presets: recordedAcoustic().presets,
        roomFit: true,
      },
      // The codec numbers are unknown for this source and answered `unknow`.
      quality: { sampleRate: 48000, bitDepth: null, bitRate: null },
      link: { snr: 35, noise: -91, freqMhz: 5260, rateMbps: 433 },
    })
  })

  it('keeps what the caches knew when the player stops answering', () => {
    const parsed = parseDevice(device({ status: null, slaves: null }))
    expect(parsed).toMatchObject({
      online: false,
      // No name to show: the address the user configured is the only truth left.
      name: '192.0.2.150',
      model: '',
      firmware: '',
      ssid: '',
      bssid: '',
      rssi: null,
      link: { snr: null, noise: null, freqMhz: null, rateMbps: null },
      // The payloads still carried their last values, and the capability and
      // acoustic caches outlive a single missed poll.
      volume: 81,
      title: 'Gogol',
      inputs: ['wifi', 'line-in', 'bluetooth', 'optical'],
      outputs: [
        { hardware: 1, name: 'Optical Out' },
        { hardware: 2, name: 'Line Out' },
        { hardware: 3, name: 'COAX Out' },
      ],
      group: { role: 'none', name: 'Apartment', saved: true },
      eq: { enabled: false, presets: recordedAcoustic().presets },
      quality: { sampleRate: 48000, bitDepth: null, bitRate: null },
    })
    expect(parsed.inputs).toHaveLength(4)
    expect(parsed.outputs).toHaveLength(3)
  })

  it('reads the signal under either spelling, and the documented key first', () => {
    expect(parseDevice(device({ status: { rssi: -62 } })).rssi).toBe(-62)
    expect(parseDevice(device({ status: { RSSI: '-51', rssi: -62 } })).rssi).toBe(-51)
    // A counter sent as a number instead of a string is still a counter.
    expect(parseDevice(device({ status: { wlanSnr: 41 } })).link.snr).toBe(41)
  })

  it('falls back to the raw hex track when the metadata is missing', () => {
    const parsed = parseDevice(device({ meta: null }))
    expect(parsed.title).toBe('Gogol')
    expect(parsed.album).toBe('Solo Piano')
    // The player answer carries the artist as an empty string, not as hex.
    expect(parsed.artist).toBe('')
  })

  it('drops the idle placeholders the firmware sends', () => {
    const parsed = parseDevice(
      device({
        meta: json(
          JSON.stringify({
            metaData: { title: 'Unknown', artist: '', albumArtURI: 'un_known' },
          })
        ),
        player: { ...json(playerStatusEx), Title: '756E6B6E6F776E' },
      })
    )
    expect(parsed.title).toBe('')
    expect(parsed.albumArt).toBe('')
  })

  it('reports no position on an external input', () => {
    const parsed = parseDevice(device({ player: { ...json(playerStatusEx), mode: '43' } }))
    expect(parsed.input).toBe('optical')
    // The firmware keeps replaying the position of the last stream it played.
    expect(parsed.curposMs).toBeNull()
    expect(parsed.totalMs).toBeNull()
    // The transport state is left alone: the device does know it is playing.
    expect(parsed.status).toBe('stop')
  })

  it('scales a streaming position the firmware reports in microseconds', () => {
    const parsed = parseDevice(
      device({
        player: { ...json(playerStatusEx), mode: '10', curpos: '60000000', totlen: '180000000' },
      })
    )
    expect(parsed.curposMs).toBe(60_000)
    expect(parsed.totalMs).toBe(180_000)
  })

  it('keeps a zero duration, which is how a live stream announces itself', () => {
    // Measured on the reference player: a pushed stream reports a growing
    // position and no duration at all.
    const parsed = parseDevice(
      device({
        player: json(
          '{"type":"0","mode":"10","vendor":"CustomPushUrl","status":"play","curpos":"3085","totlen":"0","vol":"15","mute":"0"}'
        ),
        meta: json('{"metaData":{}}'),
      })
    )
    expect(parsed.input).toBe('wifi')
    expect(parsed.curposMs).toBe(3085)
    expect(parsed.totalMs).toBe(0)
  })

  it('reads a master from the reported member list', () => {
    const parsed = parseDevice(
      device({
        slaves: json(
          '{ "Slaves": "1", "Slave_list": [ { "name": "Kitchen", "ip": "192.0.2.11", "uuid": "u1" } ] }'
        ),
        registry: { at: 0, groups: [], current: '' },
      })
    )
    expect(parsed.group).toEqual({
      role: 'master',
      name: '',
      members: [{ name: 'Kitchen', ip: '192.0.2.11', uuid: 'u1' }],
      saved: false,
    })
  })

  it('answers an unknown command or an empty body with an empty equalizer', () => {
    for (const eqRaw of ['unknown command', '', null]) {
      const parsed = parseDevice(device({ eqRaw, sleepRaw: eqRaw }))
      expect(parsed.eq).toEqual({
        enabled: false,
        name: '',
        source: '',
        bands: [],
        // The factory names come from the cached probe, not from this answer.
        presets: recordedAcoustic().presets,
        roomFit: true,
      })
      expect(parsed.sleepSeconds).toBeNull()
    }
  })

  it('sorts the bands and skips the ones it cannot read', () => {
    const parsed = parseDevice(
      device({
        eqRaw: JSON.stringify({
          EQStat: 'ON',
          source_name: 'optical',
          EQBand: [
            { index: 2, param_name: 'band2khz', value: 1 },
            { index: 1, param_name: 'band1khz', value: '-2.5' },
            { index: 0, param_name: '', value: 3 },
            { index: 3, param_name: 'band4khz', value: 'unknown' },
            'band8khz',
            null,
          ],
        }),
      })
    )
    expect(parsed.eq.enabled).toBe(true)
    expect(parsed.eq.source).toBe('optical')
    expect(parsed.eq.bands).toEqual([
      { name: 'band1khz', value: -2.5 },
      { name: 'band2khz', value: 1 },
    ])
  })
})

describe('parseCapability', () => {
  it('reads the inputs, the labels and the outputs of the recorded answers', () => {
    expect(
      parseCapability({
        inputs: inputCapability,
        enable: inputEnable,
        rename: modeRename,
        outputs: outputList,
      })
    ).toEqual({
      inputs: ['wifi', 'line-in', 'bluetooth', 'optical'],
      // This model answers `Failed` when asked to rename an input.
      inputLabels: {},
      outputs: [
        { hardware: 1, name: 'Optical Out' },
        { hardware: 2, name: 'Line Out' },
        { hardware: 3, name: 'COAX Out' },
      ],
    })
  })

  it('adds an input the user enabled but the capability list missed', () => {
    const parsed = parseCapability({
      inputs: JSON.stringify({ audioInput: [{ mode: 'wifi' }] }),
      enable: JSON.stringify({
        audioInput: [
          { mode: 'wifi', enable: 1 },
          { mode: 'optical', enable: 1 },
          { mode: 'bluetooth', enable: 0 },
        ],
      }),
      rename: JSON.stringify({ optical: 'TV' }),
      outputs: 'unknown command',
    })
    expect(parsed).toEqual({
      inputs: ['wifi', 'optical'],
      inputLabels: { optical: 'TV' },
      outputs: [],
    })
  })

  it('answers nothing rather than an empty panel when no answer is readable', () => {
    expect(
      parseCapability({ inputs: 'unknown command', enable: null, rename: '', outputs: '' })
    ).toBeNull()
  })
})

describe('parsePresets', () => {
  it('reads an empty slot list as an empty list, not as a failure', () => {
    expect(parsePresets(presetInfo)).toEqual([])
  })

  it('answers null when the player does not know the command', () => {
    expect(parsePresets('unknown command')).toBeNull()
    expect(parsePresets('')).toBeNull()
    expect(parsePresets(null)).toBeNull()
  })

  it('orders the slots, names them and skips the unusable ones', () => {
    const raw = JSON.stringify({
      preset_num: 4,
      preset_list: [
        { number: 3, name: 'Jazz', picurl: 'https://example.test/3.jpg' },
        { number: 1, name: '', picurl: 'un_known' },
        { number: 0, name: 'Invalid' },
        { name: 'No number' },
        { number: 2, name: 'Rock', picurl: 'https://example.test/2.jpg' },
        'unknown command',
      ],
    })
    expect(parsePresets(raw)).toEqual([
      { number: 1, name: '1', artwork: '' },
      { number: 2, name: 'Rock', artwork: 'https://example.test/2.jpg' },
      { number: 3, name: 'Jazz', artwork: 'https://example.test/3.jpg' },
    ])
  })
})

describe('parseRegistry', () => {
  it('reads the saved group and its offline member', () => {
    expect(parseRegistry(savedGroups)).toEqual({
      groups: [
        {
          id: '11111111-2222-3333-4444-555555555555',
          name: 'Apartment',
          members: [{ name: 'Bedroom', ip: '', uuid: 'A1B2C3D4E5F60718293A4B5C' }],
        },
      ],
      current: '11111111-2222-3333-4444-555555555555',
    })
  })

  it('separates an unreadable answer from an empty registry', () => {
    // `null` means "keep what you knew"; an empty registry is a real answer.
    expect(parseRegistry('unknown command')).toBeNull()
    expect(parseRegistry(null)).toBeNull()
    expect(parseRegistry('{ "grouplist": [] }')).toEqual({ groups: [], current: '' })
  })

  it('skips a group without an id instead of inventing one', () => {
    const raw = JSON.stringify({
      grouplist: [
        { group_name: 'No id', slavelist: [{ name: 'Bedroom' }] },
        'unknown command',
        { group_id: 'group-1', group_name: 'Studio', slavelist: 'none' },
      ],
    })
    expect(parseRegistry(raw)).toEqual({
      groups: [{ id: 'group-1', name: 'Studio', members: [] }],
      current: '',
    })
  })
})

describe('parseAcoustic', () => {
  it('reads the factory curves and the room-correction capability', () => {
    const parsed = parseAcoustic({ presets: eqList, capability: acousticCapability }, null)
    expect(parsed.roomFit).toBe(true)
    expect(parsed.presets).toHaveLength(24)
    expect(parsed.presets[0]).toBe('Flat')
    expect(parsed.presets).toContain('Small Speakers')
  })

  it('keeps each field the last good probe knew when an answer is unreadable', () => {
    const cached = { presets: ['Rock'], roomFit: true }
    expect(
      parseAcoustic({ presets: 'unknown command', capability: 'unknown command' }, cached)
    ).toEqual(cached)
    // An answer that lists no room correction does not erase a capability the
    // same player advertised before: only a probe with nothing cached starts
    // closed, and that is the test below.
    expect(
      parseAcoustic({ presets: eqList, capability: '{"Version":"1.0"}' }, cached).roomFit
    ).toBe(true)
    expect(parseAcoustic({ presets: eqList, capability: '{"Version":"1.0"}' }, null).roomFit).toBe(
      false
    )
  })

  it('starts empty when nothing was ever probed', () => {
    expect(parseAcoustic({ presets: null, capability: null }, null)).toEqual({
      presets: [],
      roomFit: false,
    })
  })
})
