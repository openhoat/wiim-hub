// The flows are the part of the diagnostic view that claims an order, so the
// order itself is what these tests pin: what runs first, where the flow stops,
// and what "could not read" looks like compared with "everything is fine".
import { describe, expect, it } from 'vitest'
import type { Diagnostics } from './device/diagnostics.ts'
import type { DeviceState } from './device/index.ts'
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
  uuid: 'A1B2C3D4E5F60718293A4B5C',
  mirror: null,
  group: { role: 'none', name: '', members: [], saved: false, parent: null },
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

  it('reads the "no sound" flow on the group a member follows, not on its own silence', () => {
    // The device answers `stop` with no track: read alone it fails the flow while
    // the room is playing, and asks for an output list it does not have.
    const mirror = {
      from: { name: 'Salon', ip: '192.0.2.10' },
      group: 'Appart',
      status: 'play',
      title: 'Track',
      artist: 'Artist',
      album: 'Album',
      albumArt: '',
      curposMs: 30_000,
      totalMs: 200_000,
      source: 'YouTubeMusic',
      updatedAt: 1,
    }
    const guide = guideOf(
      run(
        device({
          status: 'stop',
          title: '',
          group: {
            role: 'member',
            name: 'Appart',
            members: [{ name: 'Cuisine', ip: '192.0.2.11', uuid: 'u1' }],
            saved: false,
            parent: { name: 'Salon', ip: '192.0.2.10' },
          },
          mirror,
        })
      ),
      'no-sound'
    )
    expect(guide.verdict).toBeNull()
    expect(ids(guide)).toEqual(['online', 'unmuted', 'volume', 'sleepTimer', 'groupTransport'])
    const transport = guide.checks.find(entry => entry.id === 'groupTransport')
    expect(transport?.values).toEqual({ status: 'play', name: 'Salon' })

    // A paused group is worth the same warning as a paused player.
    const paused = guideOf(
      run(
        device({
          status: 'stop',
          title: '',
          group: {
            role: 'member',
            name: 'Appart',
            members: [{ name: 'Cuisine', ip: '192.0.2.11', uuid: 'u1' }],
            saved: false,
            parent: { name: 'Salon', ip: '192.0.2.10' },
          },
          mirror: { ...mirror, status: 'pause' },
        })
      ),
      'no-sound'
    )
    expect(paused.verdict?.id).toBe('groupTransport')
    expect(paused.verdict?.status).toBe('warn')
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
      run(
        device({ group: { role: 'none', name: 'Appart', members: [], saved: true, parent: null } })
      ),
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
            parent: null,
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

  it('quotes the speaker a member follows, which the fleet resolved for it', () => {
    const guide = guideOf(
      run(
        device({
          status: 'stop',
          title: '',
          group: {
            role: 'member',
            name: 'Appart',
            members: [{ name: 'Cuisine', ip: '192.0.2.11', uuid: 'u1' }],
            saved: false,
            parent: { name: 'Salon', ip: '192.0.2.10' },
          },
        })
      ),
      'cannot-join-group'
    )
    const check = guide.checks.find(entry => entry.id === 'groupMember')
    expect(check?.evidence).toBe('getStatusEx.group member of Appart, driven by Salon')
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

// Each flow can end on a known set of verdicts. The report quotes the one the
// flow stopped on, so every verdict the flows can produce needs its English
// sentence: the table below walks all of them and pins the wording, which is
// also how the "no wording" fallback stays where it belongs, out of the way.
describe('report wording', () => {
  const section = (guides: Guide[]): string => guideSection(guides).join('\n')

  type Case = {
    flow: Guide['id']
    state: Partial<DeviceState>
    diagnostics?: Diagnostics | null
    sentence: string
  }

  const external = { wifi: 'Wi-Fi', optical: 'Optical', 'line-in': 'Line In' }

  const cases: Case[] = [
    {
      flow: 'no-sound',
      state: { online: false, errors: 2 },
      sentence: 'The player does not answer: 2 consecutive poll failure(s).',
    },
    { flow: 'no-sound', state: { mute: true }, sentence: 'The player is muted.' },
    {
      flow: 'no-sound',
      state: { volume: null },
      sentence: 'The player did not report its volume.',
    },
    { flow: 'no-sound', state: { volume: 0 }, sentence: 'The volume is 0: nothing audible.' },
    { flow: 'no-sound', state: { volume: 4 }, sentence: 'The volume is 4: barely audible.' },
    {
      flow: 'no-sound',
      state: { sleepSeconds: 600 },
      sentence: 'A sleep timer will stop the player in 10 min.',
    },
    {
      flow: 'no-sound',
      state: { status: '' },
      sentence: 'The player did not report its transport state.',
    },
    {
      flow: 'no-sound',
      state: { status: 'stop' },
      sentence: 'The transport is stopped: nothing is playing.',
    },
    { flow: 'no-sound', state: { status: 'pause' }, sentence: 'The transport is paused.' },
    {
      flow: 'no-sound',
      state: { input: 'optical', mode: '43', status: 'stop', inputLabels: external },
      sentence:
        'The Optical input is selected and it is not playing: no signal reaches the player.',
    },
    {
      flow: 'no-sound',
      state: { outputs: [], outputHardware: null },
      sentence: 'The player did not report its outputs.',
    },
    {
      flow: 'no-sound',
      state: { outputHardware: null },
      sentence: 'The player did not report its active output.',
    },
    {
      flow: 'no-sound',
      state: { outputHardware: 9 },
      sentence: 'The active output (9) is not in the list the player reports.',
    },
    {
      flow: 'no-sound',
      state: { group: { role: 'member', name: 'Appart', members: [], saved: false, parent: null } },
      sentence: 'This player is a group member and the group lists no member.',
    },
    {
      flow: 'drops',
      state: { rssi: -53, link: { ...device().link, snr: 12 } },
      sentence: 'The radio link is weak: -53 dBm, 12 dB SNR.',
    },
    {
      flow: 'drops',
      state: { rssi: null, link: { ...device().link, snr: 12 } },
      sentence: 'The radio link is weak: unknown dBm, 12 dB SNR.',
    },
    {
      flow: 'drops',
      state: {},
      diagnostics: null,
      sentence: 'The network counters are not read yet.',
    },
    {
      flow: 'drops',
      state: {},
      diagnostics: diagnostics({
        health: { ...diagnostics().health!, disconnected: 3, lastMinutes: 7 },
      }),
      sentence: 'The Wi-Fi dropped 3 time(s), the last one 7 min ago.',
    },
    {
      flow: 'drops',
      state: {},
      diagnostics: diagnostics({
        health: { ...diagnostics().health!, pingFailures: 2 },
      }),
      sentence: '2 ping check(s) failed.',
    },
    {
      flow: 'drops',
      state: {},
      diagnostics: diagnostics({
        health: { ...diagnostics().health!, ethDisconnected: 1 },
      }),
      sentence: 'The wired link dropped 1 time(s).',
    },
    {
      flow: 'drops',
      state: {},
      diagnostics: diagnostics({
        health: { ...diagnostics().health!, abnormalReboots: 1 },
      }),
      sentence: 'The player rebooted abnormally 1 time(s).',
    },
    {
      flow: 'drops',
      state: {},
      diagnostics: diagnostics({
        debug: { ...diagnostics().debug!, crashes: { ...diagnostics().debug!.crashes, mcu: 1 } },
      }),
      sentence: '1 crash counter(s) are non zero: the firmware restarted.',
    },
    {
      flow: 'cannot-join-group',
      state: { wmrmVersion: '' },
      sentence: 'The player does not report the group protocol version.',
    },
    {
      flow: 'cannot-join-group',
      state: { group: { role: 'none', name: 'Appart', members: [], saved: true, parent: null } },
      sentence: 'A saved group exists but nothing runs on it.',
    },
  ]

  it('has wording for every verdict the flows can produce', () => {
    for (const entry of cases) {
      const probed = entry.diagnostics === undefined ? diagnostics() : entry.diagnostics
      const guide = guideOf(run(device(entry.state), probed), entry.flow)
      expect(guide.verdict, `${entry.flow}: ${entry.sentence}`).not.toBeNull()
      expect(guideSection([guide]).join('\n'), `${entry.flow}: ${entry.sentence}`).toContain(
        entry.sentence
      )
    }
  })

  it('never quotes a pass row, because a pass is not a verdict', () => {
    const text = section(run(device(), diagnostics()))
    expect(text).not.toContain('The player answers.')
    expect(text).not.toContain('The radio link reads')
  })

  it('falls back to the evidence when a check has no wording yet', () => {
    const check = { id: 'notWritten', status: 'warn' as const, values: {}, evidence: 'getFoo 1' }
    const fabricated: Guide = {
      id: 'drops',
      checks: [check],
      verdict: check,
      settled: true,
    }
    expect(section([fabricated])).toContain('warn at `notWritten`: notWritten: getFoo 1')
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
