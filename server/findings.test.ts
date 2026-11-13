import { describe, expect, test } from 'vitest'
import type { Diagnostics } from './device/diagnostics.ts'
import type { DeviceState } from './device/index.ts'
import { buildReport, findingsFor } from './findings.ts'
import { buildInventory } from './inventory.ts'

// A device that answers, with a link and counters a real unit reported on
// 09/11/2026: this is the baseline every test bends one signal away from.
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
  outputs: [],
  outputHardware: null,
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

const ids = (input: Parameters<typeof findingsFor>[0]): string[] =>
  findingsFor(input).map(finding => finding.id)

describe('findingsFor', () => {
  test('reports a clean device as no finding at all', () => {
    expect(findingsFor({ state: device(), diagnostics: diagnostics() })).toEqual([])
  })

  test('reports the offline state alone, not the counters behind it', () => {
    const findings = findingsFor({
      state: device({ online: false, errors: 3, lastSeen: null, rssi: null }),
      diagnostics: diagnostics({ health: { ...diagnostics().health!, disconnected: 4 } }),
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].id).toBe('offline')
    expect(findings[0].severity).toBe('alert')
    expect(findings[0].values.failures).toBe(3)
    expect(findings[0].evidence[1]).toContain('never')
  })

  test('flags a weak link from the RSSI alone', () => {
    const findings = findingsFor({
      state: device({ rssi: -74 }),
      diagnostics: diagnostics(),
    })
    expect(findings.map(finding => finding.id)).toEqual(['weakLink'])
    expect(findings[0].values.rssi).toBe(-74)
    expect(findings[0].values.band).toBe(5)
    expect(findings[0].evidence[0]).toContain('getStatusEx.RSSI')
  })

  test('flags a weak link from the SNR even when the RSSI looks fine', () => {
    expect(
      ids({ state: device({ link: { ...device().link, snr: 12 } }), diagnostics: diagnostics() })
    ).toEqual(['weakLink'])
  })

  test('does not flag a link that is only close to the threshold', () => {
    expect(
      ids({
        state: device({ rssi: -69, link: { ...device().link, snr: 21 } }),
        diagnostics: diagnostics(),
      })
    ).toEqual([])
  })

  test('reports each network counter with its source command', () => {
    const findings = findingsFor({
      state: device(),
      diagnostics: diagnostics({
        health: {
          disconnected: 2,
          ethDisconnected: 1,
          pingFailures: 5,
          abnormalReboots: 1,
          roaming: false,
          band: 1,
          lastMessage: 'CTRL-EVENT-DISCONNECTED reason=3',
          lastMinutes: 14,
        },
      }),
    })
    expect(findings.map(finding => finding.id)).toEqual([
      'wifiDrops',
      'ethDrops',
      'pingFailures',
      'abnormalReboots',
    ])
    expect(findings[0].values).toEqual({ count: 2, minutes: 14 })
    expect(findings[0].evidence[2]).toContain('reason=3')
    expect(findings[2].severity).toBe('warn')
    expect(findings[3].severity).toBe('alert')
  })

  test('sums the crash counters instead of reporting four lines', () => {
    const findings = findingsFor({
      state: device(),
      diagnostics: diagnostics({
        debug: {
          ...diagnostics().debug!,
          crashes: { controller: 2, asrTts: 0, mcu: 1, deadlock: null },
        },
      }),
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].id).toBe('crashCounters')
    expect(findings[0].values.count).toBe(3)
    expect(findings[0].evidence).toHaveLength(4)
  })

  test('reports lost UPnP actions against their total', () => {
    const findings = findingsFor({
      state: device(),
      diagnostics: diagnostics({
        debug: { ...diagnostics().debug!, upnpActionsLost: 7, upnpActionsTotal: 913 },
      }),
    })
    expect(findings[0].id).toBe('upnpActionsLost')
    expect(findings[0].values).toEqual({ lost: 7, total: 913 })
  })

  test('flags flash wear only past the worn ratio', () => {
    const worn = findingsFor({
      state: device(),
      diagnostics: diagnostics({
        hardware: { ...diagnostics().hardware!, badBlocks: 40, totalBlocks: 2000 },
      }),
    })
    expect(worn.map(finding => finding.id)).toEqual(['flashWear'])
    expect(worn[0].values.ratio).toBe('2.00 %')
    expect(
      ids({
        state: device(),
        diagnostics: diagnostics({
          hardware: { ...diagnostics().hardware!, badBlocks: 39, totalBlocks: 2000 },
        }),
      })
    ).toEqual([])
  })

  test('names every hardware field a probe reports', () => {
    const findings = findingsFor({
      state: device(),
      diagnostics: diagnostics({
        hardware: {
          ...diagnostics().hardware!,
          ethError: true,
          mfiError: true,
          flashSpaceError: true,
          soundCardError: true,
        },
      }),
    })
    expect(findings.map(finding => finding.id)).toEqual(['hardwareFault'])
    expect(findings[0].values.fields).toBe(
      'ethError, mfiChipError, flashSpaceError, soundCardHwError'
    )
    expect(findings[0].evidence[0]).toContain('getHwErrorInfo')
  })

  test('reports the push channel and a running sleep timer as info', () => {
    const findings = findingsFor({
      state: device({
        upnp: { state: 'degraded', lastEventAt: 1, events: 4, misses: 2 },
        sleepSeconds: 600,
      }),
      diagnostics: diagnostics(),
    })
    expect(findings.map(finding => finding.id)).toEqual(['eventingDegraded', 'sleepTimer'])
    expect(findings.every(finding => finding.severity === 'info')).toBe(true)
    expect(findings[1].values.minutes).toBe(10)
  })

  test('stays silent when a probe source is missing, and still reads the link', () => {
    expect(ids({ state: device({ rssi: -80 }), diagnostics: null })).toEqual(['weakLink'])
    expect(
      ids({
        state: device({ rssi: -80, link: { ...device().link, snr: null } }),
        diagnostics: null,
      })
    ).toEqual(['weakLink'])
  })

  test('reads the link from the RSSI when the SNR is missing', () => {
    expect(
      ids({ state: device({ link: { ...device().link, snr: null } }), diagnostics: diagnostics() })
    ).toEqual([])
  })
})

describe('buildReport', () => {
  const hub = { version: '0.7.0', pollMs: 3000, slowPollMs: 15_000, eventsEnabled: true }

  test('says so explicitly when nothing is wrong, and still shows the values', () => {
    const state = device()
    const diagnosticsValue = diagnostics()
    const report = buildReport({
      state,
      diagnostics: diagnosticsValue,
      findings: [],
      hub,
      now: Date.UTC(2026, 10, 9, 12, 0, 0),
    })
    expect(report.markdown).toContain('# Diagnostic report: Living Room')
    expect(report.markdown).toContain('No anomaly detected')
    expect(report.markdown).toContain('| Link | -53 dBm, 35 dB SNR, 433 Mb/s |')
    expect(report.markdown).toContain('| Hub | 0.7.0, poll 3000 ms, slow poll 15000 ms |')
    expect(report.markdown).toContain('## Raw answers')
    expect(report.markdown).toContain('"badBlocks": 5')
  })

  test('writes the offline sentence, which is the first line a support thread reads', () => {
    const state = device({ online: false, errors: 3, lastSeen: null, rssi: null })
    const report = buildReport({
      state,
      diagnostics: null,
      findings: findingsFor({ state, diagnostics: null }),
      hub,
      now: 0,
    })
    expect(report.markdown).toContain(
      '**alert** The player does not answer: 3 consecutive poll failure(s).'
    )
    expect(report.markdown).toContain('| Last seen | never |')
  })

  test('names the group a member follows, and says where its playback comes from', () => {
    // The device answers `mode 99, stop` with no track: printed alone it reads as
    // a silent speaker in no group, while the room is playing.
    const state = device({
      status: 'stop',
      title: '',
      artist: '',
      album: '',
      group: {
        role: 'member',
        name: 'Apartment',
        members: [{ name: 'Kitchen', ip: '192.0.2.11', uuid: 'u1' }],
        saved: false,
        parent: { name: 'Living Room', ip: '192.0.2.10' },
      },
      mirror: {
        from: { name: 'Living Room', ip: '192.0.2.10' },
        group: 'Apartment',
        status: 'play',
        title: 'Track',
        artist: 'Artist',
        album: 'Album',
        albumArt: '',
        curposMs: 30_000,
        totalMs: 200_000,
        source: 'YouTubeMusic',
        updatedAt: 1,
      },
    })
    const report = buildReport({
      state,
      diagnostics: null,
      findings: findingsFor({ state, diagnostics: null }),
      hub,
      now: 0,
    })
    expect(report.markdown).toContain('| Group | member, Apartment (follows Living Room) |')
    expect(report.markdown).toContain(
      '| Playback | stop, wifi, wifi, group playback from Living Room |'
    )
  })

  test('says member rather than none when the fleet could not resolve the group', () => {
    const state = device({
      group: { role: 'member', name: '', members: [], saved: false, parent: null },
    })
    const report = buildReport({
      state,
      diagnostics: null,
      findings: findingsFor({ state, diagnostics: null }),
      hub,
      now: 0,
    })
    expect(report.markdown).toContain('| Group | member |')
  })

  test('writes one sentence and its evidence per finding', () => {
    const state = device({
      rssi: -74,
      sleepSeconds: 600,
      upnp: { state: 'degraded', lastEventAt: 1, events: 4, misses: 2 },
    })
    const probed = diagnostics({
      health: {
        disconnected: 2,
        ethDisconnected: 1,
        pingFailures: 5,
        abnormalReboots: 1,
        roaming: false,
        band: 1,
        lastMessage: 'CTRL-EVENT-DISCONNECTED reason=3',
        lastMinutes: 14,
      },
      debug: {
        uptimeTicks: 20_563_200,
        crashes: { controller: 2, asrTts: 0, mcu: 1, deadlock: 0 },
        upnpActionsLost: 12,
        upnpActionsTotal: 913,
      },
      hardware: {
        ethError: true,
        mfiError: false,
        flashSpaceError: false,
        soundCardError: false,
        badBlocks: 40,
        totalBlocks: 2000,
      },
    })
    const findings = findingsFor({ state, diagnostics: probed })
    expect(findings.map(finding => finding.id)).toEqual([
      'weakLink',
      'wifiDrops',
      'ethDrops',
      'pingFailures',
      'abnormalReboots',
      'crashCounters',
      'upnpActionsLost',
      'hardwareFault',
      'flashWear',
      'eventingDegraded',
      'sleepTimer',
    ])
    const report = buildReport({
      state,
      diagnostics: probed,
      findings,
      hub: { ...hub, eventsEnabled: false },
      now: 0,
    })
    const sentences = [
      '**warn** The radio link is weak: -74 dBm, 35 dB SNR, 433 Mb/s on 5 GHz.',
      '**warn** The Wi-Fi dropped 2 time(s), the last one 14 min ago.',
      '**info** The wired link dropped 1 time(s).',
      '**warn** 5 ping check(s) failed.',
      '**alert** The player rebooted abnormally 1 time(s).',
      '**alert** 3 crash counter(s) are non zero: the firmware restarted.',
      '**info** 12 UPnP action(s) were lost out of 913.',
      '**alert** A hardware probe reports a fault: ethError.',
      '**warn** The flash shows 40 bad blocks of 2000 (2.00 %).',
      '**info** The push channel was contradicted by 2 poll(s): the hub is polling at the fast rate.',
      '**info** A sleep timer will power the player off in 10 min.',
    ]
    for (const sentence of sentences) expect(report.markdown).toContain(sentence)
    expect(report.markdown).toContain('  - getStatusEx.wlanSnr 35 dB')
    expect(report.markdown).toContain(
      '  - getNetworkHealth.lastDisconnectedMsg CTRL-EVENT-DISCONNECTED reason=3'
    )
    expect(report.markdown).toContain('  - getHwErrorInfo ethError non zero')
    expect(report.markdown).not.toContain('slow poll')
    expect(report.markdown).not.toContain('No anomaly detected')
  })

  test('puts the capability inventory between the findings and the raw answers', () => {
    const inventory = buildInventory(
      [
        { command: 'getStatusEx', area: 'identity', raw: '{ "DeviceName": "Kitchen" }' },
        { command: 'getModeRename', area: 'inputs', raw: 'Failed' },
      ],
      Date.UTC(2026, 10, 9, 12, 0, 0)
    )
    const report = buildReport({
      state: device(),
      diagnostics: diagnostics(),
      findings: [],
      hub,
      inventory,
      resolution: {
        host: 'wiim.local',
        ip: '192.0.2.150',
        resolvedBy: 'dhcp leases',
        transport: 'https',
      },
      now: Date.UTC(2026, 10, 9, 12, 0, 0),
    })
    const section = report.markdown.indexOf('## Capability inventory')
    expect(section).toBeGreaterThan(report.markdown.indexOf('## Findings'))
    expect(section).toBeLessThan(report.markdown.indexOf('## Raw answers'))
    expect(report.markdown).toContain(
      'Probe path: `wiim.local` → `192.0.2.150`, resolved by dhcp leases over https.'
    )
    expect(report.markdown).toContain('| `getModeRename` | inputs | failed | `Failed` |')
    expect(report.markdown).toContain(
      '1 supported, 0 unsupported, 1 failed, 0 empty, 0 unreachable.'
    )
  })

  test('says the inventory was skipped when the report has none', () => {
    const report = buildReport({
      state: device({ online: false }),
      diagnostics: null,
      findings: [],
      hub,
      now: 0,
    })
    expect(report.markdown).toContain('## Capability inventory')
    expect(report.markdown).toContain('Not probed: the player was offline')
    expect(report.markdown).not.toContain('| Command | Area |')
  })
})
