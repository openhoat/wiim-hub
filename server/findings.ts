// Diagnostic findings: turn what the device reports into a short list of facts,
// each with the value that supports it and the command it came from. The rule
// here is what the research notes ask for: no invented root cause, no advice the
// device cannot support, and an explicit "nothing wrong" instead of a silent
// empty list.
//
// The module is pure on purpose: the thresholds and the wording can be tested
// without a speaker, and the same findings feed the page and the support report.
import type { DeviceState, Diagnostics } from './device.ts'
import { type Inventory, inventorySection, type Resolution } from './inventory.ts'

// Measured on the reference player (09/11/2026): a healthy link reads -53 dBm,
// 35 dB SNR and 433 Mb/s at 5 GHz.
const weakRssi = -70
const weakSnr = 20
// 5 bad blocks of 2000 is the factory state of the reference player: 0.25 %.
const wornFlashRatio = 0.02

export type FindingId =
  | 'offline'
  | 'weakLink'
  | 'wifiDrops'
  | 'ethDrops'
  | 'pingFailures'
  | 'abnormalReboots'
  | 'crashCounters'
  | 'flashWear'
  | 'hardwareFault'
  | 'upnpActionsLost'
  | 'eventingDegraded'
  | 'sleepTimer'

export type Severity = 'alert' | 'warn' | 'info'

export type Finding = {
  id: FindingId
  severity: Severity
  // Values the sentence needs, already formatted: the page interpolates them in
  // its own language, the report writes them in English.
  values: Record<string, string | number>
  // Raw facts, each naming its source command, so a reader can check them.
  evidence: string[]
}

const number = (value: number | null, unit: string): string =>
  value === null ? `unknown ${unit}` : `${value} ${unit}`

const percent = (part: number, whole: number): string => `${((part / whole) * 100).toFixed(2)} %`

// Every rule reads one signal, and a rule whose source is missing stays silent:
// an absent counter is not a zero.
export const findingsFor = (input: {
  state: DeviceState
  diagnostics: Diagnostics | null
}): Finding[] => {
  const { state, diagnostics } = input
  const findings: Finding[] = []
  if (!state.online) {
    findings.push({
      id: 'offline',
      severity: 'alert',
      values: { failures: state.errors },
      evidence: [
        `last poll failed, ${state.errors} failure(s) so far`,
        `last successful poll ${state.lastSeen === null ? 'never' : new Date(state.lastSeen).toISOString()}`,
      ],
    })
    return findings
  }

  const link = state.link
  const rssi = state.rssi
  if ((rssi !== null && rssi <= weakRssi) || (link.snr !== null && link.snr < weakSnr)) {
    findings.push({
      id: 'weakLink',
      severity: 'warn',
      values: {
        rssi: rssi ?? 'unknown',
        snr: link.snr ?? 'unknown',
        band: link.freqMhz === null ? 'unknown' : Math.round(link.freqMhz / 1000),
        rate: link.rateMbps ?? 'unknown',
      },
      evidence: [
        `getStatusEx.RSSI ${number(rssi, 'dBm')} (weak below ${weakRssi})`,
        `getStatusEx.wlanSnr ${number(link.snr, 'dB')} (weak below ${weakSnr})`,
        `getStatusEx.wlanFreq ${number(link.freqMhz, 'MHz')}, wlanDataRate ${number(link.rateMbps, 'Mb/s')}`,
      ],
    })
  }

  const health = diagnostics?.health ?? null
  if (
    health?.disconnected !== null &&
    health?.disconnected !== undefined &&
    health.disconnected > 0
  ) {
    findings.push({
      id: 'wifiDrops',
      severity: 'warn',
      values: {
        count: health.disconnected,
        minutes: health.lastMinutes ?? 'unknown',
      },
      evidence: [
        `getNetworkHealth.disconnectedCount ${health.disconnected}`,
        `getNetworkHealth.lastDisconnectedTime ${number(health.lastMinutes, 'min ago')}`,
        `getNetworkHealth.lastDisconnectedMsg ${health.lastMessage === '' ? 'empty' : health.lastMessage}`,
      ],
    })
  }
  if (
    health?.ethDisconnected !== null &&
    health?.ethDisconnected !== undefined &&
    health.ethDisconnected > 0
  ) {
    findings.push({
      id: 'ethDrops',
      severity: 'info',
      values: { count: health.ethDisconnected },
      evidence: [`getNetworkHealth.ethDisconnectedCount ${health.ethDisconnected}`],
    })
  }
  if (
    health?.pingFailures !== null &&
    health?.pingFailures !== undefined &&
    health.pingFailures > 0
  ) {
    findings.push({
      id: 'pingFailures',
      severity: 'warn',
      values: { count: health.pingFailures },
      evidence: [`getNetworkHealth.pingCheckFailedCount ${health.pingFailures}`],
    })
  }
  if (
    health?.abnormalReboots !== null &&
    health?.abnormalReboots !== undefined &&
    health.abnormalReboots > 0
  ) {
    findings.push({
      id: 'abnormalReboots',
      severity: 'alert',
      values: { count: health.abnormalReboots },
      evidence: [`getNetworkHealth.wlanAbnormalRebootTimes ${health.abnormalReboots}`],
    })
  }

  const debug = diagnostics?.debug ?? null
  if (debug !== null) {
    const crashes = debug.crashes
    const total = [
      crashes.controller,
      crashes.asrTts,
      crashes.mcu,
      crashes.deadlock,
    ].reduce<number>((acc, value) => acc + (value ?? 0), 0)
    if (total > 0) {
      findings.push({
        id: 'crashCounters',
        severity: 'alert',
        values: { count: total },
        evidence: [
          `getDebugInfo.a01controller_crash ${number(crashes.controller, '')}`.trimEnd(),
          `getDebugInfo.asr_tts_crash ${number(crashes.asrTts, '')}`.trimEnd(),
          `getDebugInfo.mcu_crash ${number(crashes.mcu, '')}`.trimEnd(),
          `getDebugInfo.process_deadlock ${number(crashes.deadlock, '')}`.trimEnd(),
        ],
      })
    }
    if (debug.upnpActionsLost !== null && debug.upnpActionsLost > 0) {
      findings.push({
        id: 'upnpActionsLost',
        severity: 'info',
        values: {
          lost: debug.upnpActionsLost,
          total: debug.upnpActionsTotal ?? 'unknown',
        },
        evidence: [
          `getDebugInfo.upnp_action_lost ${debug.upnpActionsLost} of ${number(debug.upnpActionsTotal, '')}`.trimEnd(),
        ],
      })
    }
  }

  const hardware = diagnostics?.hardware ?? null
  if (hardware !== null) {
    const errors = [
      hardware.ethError ? 'ethError' : '',
      hardware.mfiError ? 'mfiChipError' : '',
      hardware.flashSpaceError ? 'flashSpaceError' : '',
      hardware.soundCardError ? 'soundCardHwError' : '',
    ].filter(entry => entry !== '')
    if (errors.length > 0) {
      findings.push({
        id: 'hardwareFault',
        severity: 'alert',
        values: { fields: errors.join(', ') },
        evidence: [`getHwErrorInfo ${errors.join(', ')} non zero`],
      })
    }
    if (
      hardware.badBlocks !== null &&
      hardware.totalBlocks !== null &&
      hardware.totalBlocks > 0 &&
      hardware.badBlocks / hardware.totalBlocks >= wornFlashRatio
    ) {
      findings.push({
        id: 'flashWear',
        severity: 'warn',
        values: {
          bad: hardware.badBlocks,
          total: hardware.totalBlocks,
          ratio: percent(hardware.badBlocks, hardware.totalBlocks),
        },
        evidence: [
          `getHwErrorInfo.badBlockNum ${hardware.badBlocks} of ${hardware.totalBlocks} (${percent(hardware.badBlocks, hardware.totalBlocks)}, worn above ${(wornFlashRatio * 100).toFixed(0)} %)`,
        ],
      })
    }
  }

  if (state.upnp.state === 'degraded') {
    findings.push({
      id: 'eventingDegraded',
      severity: 'info',
      values: { misses: state.upnp.misses },
      evidence: [
        `the UPnP subscription was contradicted by ${state.upnp.misses} poll(s), the hub is back on the fast poll`,
      ],
    })
  }
  if (state.sleepSeconds !== null && state.sleepSeconds > 0) {
    findings.push({
      id: 'sleepTimer',
      severity: 'info',
      values: { minutes: Math.round(state.sleepSeconds / 60) },
      evidence: [`getShutdown ${state.sleepSeconds} s, the player will power off on its own`],
    })
  }

  return findings
}

const sentences: Record<FindingId, (values: Record<string, string | number>) => string> = {
  offline: values => `The player does not answer: ${values.failures} consecutive poll failure(s).`,
  weakLink: values =>
    `The radio link is weak: ${values.rssi} dBm, ${values.snr} dB SNR, ${values.rate} Mb/s on ${values.band} GHz.`,
  wifiDrops: values =>
    `The Wi-Fi dropped ${values.count} time(s), the last one ${values.minutes} min ago.`,
  ethDrops: values => `The wired link dropped ${values.count} time(s).`,
  pingFailures: values => `${values.count} ping check(s) failed.`,
  abnormalReboots: values => `The player rebooted abnormally ${values.count} time(s).`,
  crashCounters: values => `${values.count} crash counter(s) are non zero: the firmware restarted.`,
  flashWear: values =>
    `The flash shows ${values.bad} bad blocks of ${values.total} (${values.ratio}).`,
  hardwareFault: values => `A hardware probe reports a fault: ${values.fields}.`,
  upnpActionsLost: values => `${values.lost} UPnP action(s) were lost out of ${values.total}.`,
  eventingDegraded: values =>
    `The push channel was contradicted by ${values.misses} poll(s): the hub is polling at the fast rate.`,
  sleepTimer: values => `A sleep timer will power the player off in ${values.minutes} min.`,
}

const sentenceFor = (finding: Finding): string => sentences[finding.id](finding.values)

// The report is the artefact a user pastes into a support thread: facts first,
// then the raw answers, so the reader can check every claim.
export const buildReport = (input: {
  state: DeviceState
  diagnostics: Diagnostics | null
  findings: Finding[]
  hub: { version: string; pollMs: number; slowPollMs: number; eventsEnabled: boolean }
  // Omitted state reads as "not probed": the demo and the tests that only care
  // about the findings do not have to fabricate an inventory.
  inventory?: Inventory | null
  resolution?: Resolution | null
  now?: number
}): { generatedAt: number; markdown: string } => {
  const { state, diagnostics, findings, hub } = input
  const generatedAt = input.now ?? Date.now()
  const rows: [string, string][] = [
    ['Device', state.name],
    ['Address', state.ip],
    ['Model', state.model || 'unknown'],
    ['Firmware', `${state.firmware || 'unknown'} (${state.release || 'unknown'})`],
    [
      'Hub',
      `${hub.version}, poll ${hub.pollMs} ms${hub.eventsEnabled ? `, slow poll ${hub.slowPollMs} ms` : ''}`,
    ],
    ['Events', `${state.upnp.state} (${state.upnp.events} received)`],
    ['Network', `${state.ssid || 'unknown'} (${state.bssid || 'unknown'})`],
    [
      'Link',
      `${number(state.rssi, 'dBm')}, ${number(state.link.snr, 'dB SNR')}, ${number(state.link.rateMbps, 'Mb/s')}`,
    ],
    [
      'Playback',
      `${state.status || 'unknown'}, ${state.source || 'no source'}, ${state.input || 'no input'}`,
    ],
    [
      'Volume',
      state.volume === null ? 'unknown' : `${state.volume}${state.mute ? ' (muted)' : ''}`,
    ],
    ['Group', state.group.name === '' ? 'none' : `${state.group.role}, ${state.group.name}`],
    ['Last seen', state.lastSeen === null ? 'never' : new Date(state.lastSeen).toISOString()],
  ]
  const lines: string[] = []
  lines.push(`# Diagnostic report: ${state.name}`, '')
  lines.push(`Generated ${new Date(generatedAt).toISOString()} by wiim-hub ${hub.version}.`, '')
  lines.push('| Field | Value |', '| --- | --- |')
  for (const [label, value] of rows) lines.push(`| ${label} | ${value} |`)
  lines.push('')
  if (findings.length === 0) {
    lines.push('## Findings', '', 'No anomaly detected. The values above are the evidence.', '')
  } else {
    lines.push('## Findings', '')
    for (const finding of findings) {
      lines.push(`- **${finding.severity}** ${sentenceFor(finding)}`)
      for (const evidence of finding.evidence) lines.push(`  - ${evidence}`)
    }
    lines.push('')
  }
  lines.push(...inventorySection(input.inventory ?? null, input.resolution ?? null, generatedAt))
  lines.push('## Raw answers', '', '```json')
  lines.push(
    JSON.stringify({ diagnostics, link: state.link, samples: state.samples.slice(-10) }, null, 2)
  )
  lines.push('```', '')
  return { generatedAt, markdown: lines.join('\n') }
}
