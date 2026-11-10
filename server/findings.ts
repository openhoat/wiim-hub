// Diagnostic findings: turn what the device reports into a short list of facts,
// each with the value that supports it and the command it came from. The rule
// here is what the research notes ask for: no invented root cause, no advice the
// device cannot support, and an explicit "nothing wrong" instead of a silent
// empty list.
//
// The module is pure on purpose: the thresholds and the wording can be tested
// without a speaker, and the same findings feed the page and the support report.

import type { Diagnostics } from './device/diagnostics.ts'
import type { DeviceState } from './device/index.ts'
import { type Guide, guideSection } from './guides.ts'
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

type Health = NonNullable<Diagnostics['health']>
type Debug = NonNullable<Diagnostics['debug']>
type Hardware = NonNullable<Diagnostics['hardware']>

// An absent counter is not a zero: every drop rule goes through this, so a
// missing field stays silent instead of firing on an undefined.
const positive = (value: number | null | undefined): number | null =>
  value === null || value === undefined || value <= 0 ? null : value

const offlineFinding = (state: DeviceState): Finding => ({
  id: 'offline',
  severity: 'alert',
  values: { failures: state.errors },
  evidence: [
    `last poll failed, ${state.errors} failure(s) so far`,
    `last successful poll ${state.lastSeen === null ? 'never' : new Date(state.lastSeen).toISOString()}`,
  ],
})

const weakLinkFinding = (state: DeviceState): Finding | null => {
  const { link, rssi } = state
  const weak = (rssi !== null && rssi <= weakRssi) || (link.snr !== null && link.snr < weakSnr)
  if (!weak) return null
  return {
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
  }
}

const wifiDropsFinding = (health: Health | null): Finding | null => {
  const count = health === null ? null : positive(health.disconnected)
  if (health === null || count === null) return null
  return {
    id: 'wifiDrops',
    severity: 'warn',
    values: { count, minutes: health.lastMinutes ?? 'unknown' },
    evidence: [
      `getNetworkHealth.disconnectedCount ${count}`,
      `getNetworkHealth.lastDisconnectedTime ${number(health.lastMinutes, 'min ago')}`,
      `getNetworkHealth.lastDisconnectedMsg ${health.lastMessage === '' ? 'empty' : health.lastMessage}`,
    ],
  }
}

const ethDropsFinding = (health: Health | null): Finding | null => {
  const count = health === null ? null : positive(health.ethDisconnected)
  if (count === null) return null
  return {
    id: 'ethDrops',
    severity: 'info',
    values: { count },
    evidence: [`getNetworkHealth.ethDisconnectedCount ${count}`],
  }
}

const pingFailuresFinding = (health: Health | null): Finding | null => {
  const count = health === null ? null : positive(health.pingFailures)
  if (count === null) return null
  return {
    id: 'pingFailures',
    severity: 'warn',
    values: { count },
    evidence: [`getNetworkHealth.pingCheckFailedCount ${count}`],
  }
}

const abnormalRebootsFinding = (health: Health | null): Finding | null => {
  const count = health === null ? null : positive(health.abnormalReboots)
  if (count === null) return null
  return {
    id: 'abnormalReboots',
    severity: 'alert',
    values: { count },
    evidence: [`getNetworkHealth.wlanAbnormalRebootTimes ${count}`],
  }
}

const crashCountersFinding = (debug: Debug | null): Finding | null => {
  if (debug === null) return null
  const crashes = debug.crashes
  const total = [crashes.controller, crashes.asrTts, crashes.mcu, crashes.deadlock].reduce<number>(
    (acc, value) => acc + (value ?? 0),
    0
  )
  if (total === 0) return null
  return {
    id: 'crashCounters',
    severity: 'alert',
    values: { count: total },
    evidence: [
      `getDebugInfo.a01controller_crash ${number(crashes.controller, '')}`.trimEnd(),
      `getDebugInfo.asr_tts_crash ${number(crashes.asrTts, '')}`.trimEnd(),
      `getDebugInfo.mcu_crash ${number(crashes.mcu, '')}`.trimEnd(),
      `getDebugInfo.process_deadlock ${number(crashes.deadlock, '')}`.trimEnd(),
    ],
  }
}

const upnpActionsLostFinding = (debug: Debug | null): Finding | null => {
  const lost = debug === null ? null : positive(debug.upnpActionsLost)
  if (debug === null || lost === null) return null
  return {
    id: 'upnpActionsLost',
    severity: 'info',
    values: { lost, total: debug.upnpActionsTotal ?? 'unknown' },
    evidence: [
      `getDebugInfo.upnp_action_lost ${lost} of ${number(debug.upnpActionsTotal, '')}`.trimEnd(),
    ],
  }
}

const hardwareFaultFinding = (hardware: Hardware | null): Finding | null => {
  if (hardware === null) return null
  const errors = [
    hardware.ethError ? 'ethError' : '',
    hardware.mfiError ? 'mfiChipError' : '',
    hardware.flashSpaceError ? 'flashSpaceError' : '',
    hardware.soundCardError ? 'soundCardHwError' : '',
  ].filter(entry => entry !== '')
  if (errors.length === 0) return null
  return {
    id: 'hardwareFault',
    severity: 'alert',
    values: { fields: errors.join(', ') },
    evidence: [`getHwErrorInfo ${errors.join(', ')} non zero`],
  }
}

const flashWearFinding = (hardware: Hardware | null): Finding | null => {
  if (hardware === null) return null
  const { badBlocks, totalBlocks } = hardware
  if (badBlocks === null || totalBlocks === null || totalBlocks === 0) return null
  if (badBlocks / totalBlocks < wornFlashRatio) return null
  return {
    id: 'flashWear',
    severity: 'warn',
    values: {
      bad: badBlocks,
      total: totalBlocks,
      ratio: percent(badBlocks, totalBlocks),
    },
    evidence: [
      `getHwErrorInfo.badBlockNum ${badBlocks} of ${totalBlocks} (${percent(badBlocks, totalBlocks)}, worn above ${(wornFlashRatio * 100).toFixed(0)} %)`,
    ],
  }
}

const eventingFinding = (state: DeviceState): Finding | null => {
  if (state.upnp.state !== 'degraded') return null
  return {
    id: 'eventingDegraded',
    severity: 'info',
    values: { misses: state.upnp.misses },
    evidence: [
      `the UPnP subscription was contradicted by ${state.upnp.misses} poll(s), the hub is back on the fast poll`,
    ],
  }
}

const sleepTimerFinding = (state: DeviceState): Finding | null => {
  const seconds = state.sleepSeconds
  if (seconds === null || seconds <= 0) return null
  return {
    id: 'sleepTimer',
    severity: 'info',
    values: { minutes: Math.round(seconds / 60) },
    evidence: [`getShutdown ${seconds} s, the player will power off on its own`],
  }
}

// Every rule reads one signal, and a rule whose source is missing stays silent:
// an absent counter is not a zero. Keeping them as one list makes the order of
// the report explicit instead of an accident of statement order.
export const findingsFor = (input: {
  state: DeviceState
  diagnostics: Diagnostics | null
}): Finding[] => {
  const { state, diagnostics } = input
  if (!state.online) return [offlineFinding(state)]
  const health = diagnostics?.health ?? null
  const debug = diagnostics?.debug ?? null
  const hardware = diagnostics?.hardware ?? null
  return [
    weakLinkFinding(state),
    wifiDropsFinding(health),
    ethDropsFinding(health),
    pingFailuresFinding(health),
    abnormalRebootsFinding(health),
    crashCountersFinding(debug),
    upnpActionsLostFinding(debug),
    hardwareFaultFinding(hardware),
    flashWearFinding(hardware),
    eventingFinding(state),
    sleepTimerFinding(state),
  ].filter((entry): entry is Finding => entry !== null)
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
  // The guided checks are derived from the same state, so a caller that built
  // the findings can always supply them; omitting them drops the section.
  guides?: Guide[] | null
  now?: number
}): { generatedAt: number; markdown: string } => {
  const { state, diagnostics, findings, hub } = input
  const generatedAt = input.now ?? Date.now()
  const slowPoll = hub.eventsEnabled ? `, slow poll ${hub.slowPollMs} ms` : ''
  const muted = state.mute ? ' (muted)' : ''
  const volume = state.volume === null ? 'unknown' : `${state.volume}${muted}`
  const rows: [string, string][] = [
    ['Device', state.name],
    ['Address', state.ip],
    ['Model', state.model || 'unknown'],
    ['Firmware', `${state.firmware || 'unknown'} (${state.release || 'unknown'})`],
    ['Hub', `${hub.version}, poll ${hub.pollMs} ms${slowPoll}`],
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
    ['Volume', volume],
    ['Group', state.group.name === '' ? 'none' : `${state.group.role}, ${state.group.name}`],
    ['Last seen', state.lastSeen === null ? 'never' : new Date(state.lastSeen).toISOString()],
  ]
  const lines: string[] = []
  lines.push(
    `# Diagnostic report: ${state.name}`,
    '',
    `Generated ${new Date(generatedAt).toISOString()} by wiim-hub ${hub.version}.`,
    '',
    '| Field | Value |',
    '| --- | --- |'
  )
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
  lines.push(
    ...(input.guides ? guideSection(input.guides) : []),
    ...inventorySection(input.inventory ?? null, input.resolution ?? null, generatedAt),
    '## Raw answers',
    '',
    '```json',
    JSON.stringify({ diagnostics, link: state.link, samples: state.samples.slice(-10) }, null, 2),
    '```',
    ''
  )
  return { generatedAt, markdown: lines.join('\n') }
}
