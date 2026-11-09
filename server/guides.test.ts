// The flows are the part of the diagnostic view that claims an order, so the
// order itself is what these tests pin: what runs first, where the flow stops,
// and what "could not read" looks like compared with "everything is fine".
import { describe, expect, it } from 'vitest'
import type { DeviceState, Diagnostics } from './device.ts'
import { type Guide, guideOrder, guideSection, guidesFor } from './guides.ts'

// The baseline is the reference player as it reads when nothing is wrong:
// playing, unmuted, audible, no sleep timer, on https, with two Wi-Fi drops
// that already happened.
const device = (overrides: Partial<DeviceState> = {}): DeviceState => ({
  ip: '192.0.2.10',
  name: 'Living Room',
  model: 'WiiM Pro',
  firmware: 'Linkplay.4.8',
  release: '20261027',
  ssid: 'lab',
  bssid: 'aa:bb:cc:dd:ee:ff',
  wmrmVersion: '4.3',
  group: { role: 'none', name: '', members: [], saved: false },
  rssi: -53,
  volume: 30,
  status: 'play',
  title: 'Track',
  artist: 'Artist',
  album: 'Album',
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
  outputs: [
    { hardware: 1, name: 'Optical Out' },
    { hardware: 2, name: 'Line Out' },
  ],
  outputHardware: 2,
  presets: [],
  eq: { enabled: false, name: '', source: '', bands: [], presets: [], roomFit: false },
  quality: { sampleRate: 48000, bitDepth: 16, bitRate: 128 },
  updatedAt: 1,
  online: true,
  lastSeen: 1,
  errors: 0,
  upnp: { state: 'subscribed', lastEventAt: 1, events: 10, misses: 0 },
  link: { snr: 35, noise: -91, freqMhz: 5260, rateMbps: 433 },
  diagnostics: null,
  samples: [],
  events: [],
  ...overrides,
})

const diagnostics = (overrides: Partial<Diagnostics> = {}): Diagnostics => ({
  at: 1,
  health: {
    disconnected: 0,
    ethDisconnected: 0,
    pingFailures: 0,
    abnormalReboots: 0,
    roaming: false,
    band: 1,
    lastMessage: '',
    lastMinutes: null,
  },
  debug: {
    uptimeTicks: 20_563_200,
    crashes: { controller: 0, asrTts: 0, mcu: 0, deadlock: 0 },
    upnpActionsLost: 0,
    upnpActionsTotal: 913,
  },
  hardware: {
    ethError: false,
    mfiError: false,
    flashSpaceError: false,
    soundCardError: false,
    badBlocks: 5,
    totalBlocks: 2000,
  },
  ...overrides,
})

const run = (state: DeviceState, probed: Diagnostics | null = null): Guide[] =>
  guidesFor({ state, diagnostics: probed })

const guideOf = (guides: Guide[], id: Guide['id']): Guide => {
  const guide = guides.find(entry => entry.id === id)
  if (guide === undefined) throw new Error(`missing guide ${id}`)
  return guide
}

const ids = (guide: Guide): string[] => guide.checks.map(check => check.id)

describe('guidesFor', () => {
  it('always answers the four flows, in the order the page lists them', () => {
    expect(run(device()).map(guide => guide.id)).toEqual([...guideOrder])
    expect(guideOrder).toEqual(['no-sound', 'drops', 'wrong-output', 'cannot-join-group'])
  })

  it('reads a healthy player as no anomaly on every flow', () => {
    const guides = run(device(), diagnostics())
    expect(guides.map(guide => guide.verdict)).toEqual([null, null, null, null])
    expect(guides.every(guide => guide.settled)).toBe(true)
  })

  it('stops the "no sound" flow at the first anomaly, mute before volume', () => {
    const guide = guideOf(run(device({ mute: true, volume: 0 })), 'no-sound')
    expect(ids(guide)).toEqual(['online', 'muted'])
    expect(guide.verdict?.id).toBe('muted')
    expect(guide.verdict?.values).toEqual({})
  })

  it('ranks a silent volume as a failure and a low one as a warning', () => {
    expect(guideOf(run(device({ volume: 0 })), 'no-sound').verdict?.id).toBe('noVolume')
    const low = guideOf(run(device({ volume: 3 })), 'no-sound')
    expect(low.verdict?.id).toBe('lowVolume')
    expect(low.verdict?.status).toBe('warn')
    expect(low.verdict?.values).toEqual({ volume: 3 })
  })

  it('keeps the checks that passed in front of the anomaly', () => {
    const guide = guideOf(run(device({ status: 'stop' })), 'no-sound')
    expect(ids(guide)).toEqual(['online', 'unmuted', 'volume', 'sleepTimer', 'stopped'])
    expect(guide.verdict?.id).toBe('stopped')
  })

  it('blames the selected input when an external one carries no signal', () => {
    const inputLabels = { wifi: 'Wi-Fi', optical: 'Optical', 'line-in': 'Line In' }

    const playing = guideOf(run(device({ input: 'optical', mode: '43', inputLabels })), 'no-sound')
    expect(ids(playing)).toContain('source')
    expect(playing.verdict).toBeNull()

    // Optical selected but the transport is not playing: the source is checked
    // first, so the input is named instead of the generic "transport stopped".
    const silent = guideOf(
      run(device({ input: 'optical', mode: '43', status: 'stop', inputLabels })),
      'no-sound'
    )
    expect(silent.verdict?.id).toBe('externalSilent')
    expect(silent.verdict?.values).toEqual({ input: 'Optical', status: 'stop' })

    const loading = guideOf(
      run(device({ input: 'line-in', mode: '43', status: 'loading', inputLabels })),
      'no-sound'
    )
    expect(loading.verdict?.id).toBe('externalSilent')
  })

  it('names the active route and the routes the player reports', () => {
    const output = guideOf(run(device()), 'wrong-output').checks.at(-1)
    expect(output?.id).toBe('output')
    expect(output?.values).toEqual({ active: 'Line Out', available: 'Optical Out, Line Out' })
  })

  it('fails on an output the player does not list, and stops when it lists none', () => {
    const unlisted = guideOf(run(device({ outputHardware: 9 })), 'wrong-output')
    expect(unlisted.verdict?.id).toBe('outputUnlisted')
    expect(unlisted.verdict?.values).toEqual({ hardware: 9 })

    const none = guideOf(run(device({ outputs: [], outputHardware: null })), 'wrong-output')
    expect(none.verdict?.status).toBe('unknown')
    expect(none.settled).toBe(false)
  })

  it('separates a network drop from a reboot or a crash', () => {
    const drops = guideOf(
      run(
        device(),
        diagnostics({
          health: {
            ...diagnostics().health!,
            disconnected: 2,
            lastMinutes: 14,
            abnormalReboots: 1,
          },
        })
      ),
      'drops'
    )
    expect(drops.verdict?.id).toBe('wifiDrops')
    expect(drops.verdict?.values).toEqual({ count: 2, minutes: 14 })

    const crash = guideOf(
      run(
        device(),
        diagnostics({
          debug: {
            ...diagnostics().debug!,
            crashes: { controller: 0, asrTts: 0, mcu: 2, deadlock: 0 },
          },
        })
      ),
      'drops'
    )
    expect(crash.verdict?.id).toBe('crashCounters')
    expect(crash.verdict?.status).toBe('fail')
  })

  it('stops the "drops" flow when the counters are not read yet', () => {
    const guide = guideOf(run(device(), null), 'drops')
    expect(ids(guide)).toEqual(['online', 'link', 'counters'])
    expect(guide.verdict?.id).toBe('counters')
    expect(guide.settled).toBe(false)
  })

  it('reads the link before the counters, because the poll carries it', () => {
    const guide = guideOf(run(device({ rssi: -74 }), null), 'drops')
    expect(ids(guide)).toEqual(['online', 'weakLink'])
    expect(guide.verdict?.id).toBe('weakLink')
  })

  it('reads a saved group that keeps nothing running, and one that does', () => {
    const saved = guideOf(
      run(device({ group: { role: 'none', name: 'Appart', members: [], saved: true } })),
      'cannot-join-group'
    )
    expect(saved.verdict?.id).toBe('groupSavedOnly')
    expect(saved.verdict?.status).toBe('warn')

    const member = guideOf(
      run(
        device({
          group: {
            role: 'member',
            name: 'Appart',
            members: [{ name: 'Kitchen', ip: '192.0.2.11', uuid: 'u1' }],
            saved: false,
          },
        })
      ),
      'cannot-join-group'
    )
    expect(member.verdict).toBeNull()
    expect(member.checks.map(check => check.id)).toEqual([
      'online',
      'groupCommands',
      'groupMember',
      'link',
    ])
  })

  it('admits when this model cannot answer the group commands at all', () => {
    const guide = guideOf(run(device({ wmrmVersion: '' })), 'cannot-join-group')
    expect(guide.verdict?.id).toBe('groupCommandsMissing')
    expect(guide.verdict?.status).toBe('unknown')
    expect(guide.settled).toBe(false)
  })

  it('makes every flow an offline failure when the player does not answer', () => {
    const guides = run(device({ online: false, errors: 3 }))
    for (const guide of guides) {
      expect(guide.checks).toHaveLength(1)
      expect(guide.verdict?.id).toBe('offline')
      expect(guide.verdict?.values).toEqual({ failures: 3 })
    }
  })
})

describe('guideSection', () => {
  const section = (guides: Guide[]): string => guideSection(guides).join('\n')

  it('writes one line per flow, and says when a flow found nothing', () => {
    const text = section(run(device(), diagnostics()))
    expect(text).toContain('## Guided checks')
    expect(text).toContain('- **No sound**: all 6 check(s) passed.')
    expect(text).toContain('- **Wrong output**: all 2 check(s) passed.')
  })

  it('writes the verdict with its field, so a reader can check the claim', () => {
    const text = section(run(device({ mute: true, volume: 0 }), diagnostics()))
    expect(text).toContain(
      '- **No sound**: fail at `muted`: The player is muted. (getPlayerStatusEx.mute 1)'
    )
    // The rest of the flow never ran, so nothing after the mute is claimed.
    expect(text).not.toContain('nothing audible')
  })

  it('says "not read" where the device gave nothing to read', () => {
    const text = section(run(device(), null))
    expect(text).toContain(
      '- **It drops**: not read at `counters`: The network counters are not read yet.'
    )
  })

  it('keeps the counts of a flow short enough to paste', () => {
    const lines = guideSection(run(device({ rssi: -74, mute: true }), diagnostics()))
    expect(lines.filter(line => line.startsWith('- **'))).toHaveLength(4)
  })
})
