import { describe, expect, test } from 'vitest'
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
  shutdown,
  slaveList,
  statusEx,
} from '../fixtures/wiim-pro.ts'
import { type Acoustic, parseAcoustic } from './acoustic.ts'
import { parseDevice } from './index.ts'
import { type Capability, parseCapability } from './inputs.ts'
import type { Registry } from './multiroom.ts'

// ---------------------------------------------------------------------------
// The whole patch, against the answers the reference player actually sent
// (`./fixtures/wiim-pro.ts`). The area suites pin one parser each; this one
// pins what the hub does with all of them at once.
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

const recordedCapability = (): Capability => ({
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

const recordedAcoustic = (): Acoustic => ({
  at: 0,
  ...parseAcoustic({ presets: eqList, capability: acousticCapability }, null),
})

const savedRegistry = (): Registry => ({
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
  modelName: '',
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
  test('turns the recorded answers into one device patch', () => {
    expect(parseDevice(device())).toEqual({
      ip: '192.0.2.150',
      online: true,
      name: 'Living Room',
      // The model is only ever sent as `project` on this firmware, and the
      // vendor suffix is not part of the name a user reads. A description read
      // in `pollDevice` beats it, which is what the next test pins.
      model: 'WiiM Pro',
      firmware: 'Linkplay.4.8.833748',
      release: '20261027',
      // `essid` is hex on this firmware.
      ssid: 'HomeNet-5G',
      bssid: '02:00:00:00:00:05',
      // The multiroom protocol the group guide checks first.
      wmrmVersion: '4.3',
      // The identity a group command names this speaker by, short form.
      uuid: 'A1B2C3D4E5F60718293A4B5C',
      group: {
        role: 'none',
        name: 'Apartment',
        members: [{ name: 'Bedroom', ip: '', uuid: 'A1B2C3D4E5F60718293A4B5C' }],
        saved: true,
        parent: null,
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
      // A cast is the network input: `switchmode:wifi` is what the picker would
      // return to, so the source row lights that entry instead of nothing.
      mode: '5',
      input: 'wifi',
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

  test('keeps what the caches knew when the player stops answering', () => {
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
      group: { role: 'none', name: 'Apartment', saved: true, parent: null },
      eq: { enabled: false, presets: recordedAcoustic().presets },
      quality: { sampleRate: 48000, bitDepth: null, bitRate: null },
    })
    expect(parsed.inputs).toHaveLength(4)
    expect(parsed.outputs).toHaveLength(3)
  })

  test('takes the master a member names from its own status', () => {
    // `master_ip` is the member's own answer, and the steadiest one: it lets the
    // fleet parent the member even on a poll where the master listed nothing.
    const parsed = parseDevice(
      device({ status: { group: '1', master_ip: '192.0.2.150', master_uuid: 'FF9700' } })
    )
    expect(parsed.group.role).toBe('member')
    // The fleet names it: an address alone is not a card.
    expect(parsed.group.parent).toEqual({ name: '', ip: '192.0.2.150' })
  })

  test('reads the signal under either spelling, and the documented key first', () => {
    expect(parseDevice(device({ status: { rssi: -62 } })).rssi).toBe(-62)
    expect(parseDevice(device({ status: { RSSI: '-51', rssi: -62 } })).rssi).toBe(-51)
    // A counter sent as a number instead of a string is still a counter.
    expect(parseDevice(device({ status: { wlanSnr: 41 } })).link.snr).toBe(41)
  })

  test('falls back to the raw hex track when the metadata is missing', () => {
    const parsed = parseDevice(device({ meta: null }))
    expect(parsed.title).toBe('Gogol')
    expect(parsed.album).toBe('Solo Piano')
    // The player answer carries the artist as an empty string, not as hex.
    expect(parsed.artist).toBe('')
  })

  test('drops the idle placeholders the firmware sends', () => {
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

  test('reports no position on an external input', () => {
    const parsed = parseDevice(device({ player: { ...json(playerStatusEx), mode: '43' } }))
    expect(parsed.input).toBe('optical')
    // The firmware keeps replaying the position of the last stream it played.
    expect(parsed.curposMs).toBeNull()
    expect(parsed.totalMs).toBeNull()
    // The transport state is left alone: the device does know it is playing.
    expect(parsed.status).toBe('stop')
  })

  test('scales a streaming position the firmware reports in microseconds', () => {
    const parsed = parseDevice(
      device({
        player: { ...json(playerStatusEx), mode: '10', curpos: '60000000', totlen: '180000000' },
      })
    )
    expect(parsed.curposMs).toBe(60_000)
    expect(parsed.totalMs).toBe(180_000)
  })

  test('keeps a zero duration, which is how a live stream announces itself', () => {
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

  test('reads a master from the reported member list', () => {
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
      parent: null,
    })
  })

  test('answers an unknown command or an empty body with an empty equalizer', () => {
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

  test('sorts the bands and skips the ones it cannot read', () => {
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

describe('parseDevice, model and identity', () => {
  test('prefers the name the device publishes over the internal project string', () => {
    // Measured: the Mini says `project: "Muzo_Mini"` and calls itself "WiiM Mini
    // Receiver" in its UPnP description, so the description wins.
    expect(parseDevice(device({ modelName: 'WiiM Mini' })).model).toBe('WiiM Mini')
  })

  test('falls back to the project string when the description did not answer', () => {
    expect(parseDevice(device({ modelName: '' })).model).toBe('WiiM Pro')
  })

  test('reads the group identity from either spelling of the status', () => {
    expect(parseDevice(device()).uuid).toBe('A1B2C3D4E5F60718293A4B5C')
    const status = {
      ...json(statusEx),
      uuid: '',
      upnp_uuid: 'uuid:A1B2C3D4-E5F6-0718-293A-4B5CA1B2C3D4',
    }
    // A build that only publishes the dashed UPnP form still answers with the
    // value a join takes: the scheme prefix goes, the dashes stay.
    expect(parseDevice(device({ status })).uuid).toBe('A1B2C3D4-E5F6-0718-293A-4B5CA1B2C3D4')
  })
})
