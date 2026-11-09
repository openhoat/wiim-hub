// Guided checks: the four questions a user actually arrives with ("no sound",
// "it drops", "wrong output", "cannot join a group"), answered by reading the
// device in a fixed order and stopping at the first anomaly.
//
// The point is determinism, not intelligence: the order is the diagnostic
// reasoning, each check names the field it read, and a check that cannot be
// read stops the flow instead of guessing. The same rules feed the page (in its
// own language) and the support report (in English).
import type { DeviceState, Diagnostics } from './device.ts'

export type GuideId = 'no-sound' | 'drops' | 'wrong-output' | 'cannot-join-group'

// `unknown` is not `pass`: the flow stops there and says what it could not read.
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown'

export type GuideCheck = {
  id: string
  status: CheckStatus
  // Values the sentence needs, already formatted: the page interpolates them in
  // its own language, the report writes them in English.
  values: Record<string, string | number>
  // The field that was read, so a reader can check the claim.
  evidence: string
}

export type Guide = {
  id: GuideId
  // The checks that ran, in order. The last one is the first anomaly when there
  // is one: everything after it would be noise.
  checks: GuideCheck[]
  verdict: GuideCheck | null
  // False when the flow stopped on a check it could not read: "no anomaly" and
  // "could not tell" must not look the same.
  settled: boolean
}

const check = (
  id: string,
  status: CheckStatus,
  evidence: string,
  values: Record<string, string | number> = {}
): GuideCheck => ({ id, status, values, evidence })

const optional = (checks: Array<GuideCheck | null>): GuideCheck[] =>
  checks.filter((entry): entry is GuideCheck => entry !== null)

// Measured on the reference player: a healthy link reads -53 dBm and 35 dB SNR.
const weakRssi = -70
const weakSnr = 20
// A player at 0 is silent; under 5 the user hears "it is broken" as well.
const silentVolume = 0
const lowVolume = 5

const offline = (state: DeviceState): GuideCheck =>
  state.online
    ? check('online', 'pass', `last poll: ${state.errors} failure(s)`)
    : check('offline', 'fail', `last poll: ${state.errors} failure(s)`, {
        failures: state.errors,
      })

const linkCheck = (state: DeviceState): GuideCheck | null => {
  const { rssi } = state
  const snr = state.link.snr
  if (rssi === null && snr === null) return null
  const weak = (rssi !== null && rssi <= weakRssi) || (snr !== null && snr < weakSnr)
  const values = {
    rssi: rssi ?? 'unknown',
    snr: snr ?? 'unknown',
  }
  return check(
    weak ? 'weakLink' : 'link',
    weak ? 'warn' : 'pass',
    `getStatusEx.RSSI ${rssi ?? '?'} dBm, wlanSnr ${snr ?? '?'} dB`,
    values
  )
}

const volumeCheck = (state: DeviceState): GuideCheck => {
  const volume = state.volume
  if (volume === null) return check('volumeUnknown', 'unknown', 'getPlayerStatusEx.vol missing')
  if (volume === silentVolume) {
    return check('noVolume', 'fail', `getPlayerStatusEx.vol ${volume}`, { volume })
  }
  if (volume <= lowVolume) {
    return check('lowVolume', 'warn', `getPlayerStatusEx.vol ${volume}`, { volume })
  }
  return check('volume', 'pass', `getPlayerStatusEx.vol ${volume}`, { volume })
}

const transportCheck = (state: DeviceState): GuideCheck => {
  if (state.status === '') {
    return check('transportUnknown', 'unknown', 'getPlayerStatusEx.status missing')
  }
  if (state.status === 'stop') {
    return check('stopped', 'fail', 'getPlayerStatusEx.status stop', { status: state.status })
  }
  if (state.status === 'pause') {
    return check('paused', 'warn', 'getPlayerStatusEx.status pause', { status: state.status })
  }
  return check('transport', 'pass', `getPlayerStatusEx.status ${state.status}`, {
    status: state.status,
  })
}

// The analogue and optical inputs carry a signal, not a track: `play` means the
// signal is there, anything else means the wire is silent and the player is not
// at fault.
const sourceCheck = (state: DeviceState): GuideCheck | null => {
  const external = state.input === 'optical' || state.input === 'line-in'
  if (!external) return null
  const input = state.inputLabels[state.input] || state.input
  const playing = state.status === 'play'
  return check(
    playing ? 'source' : 'externalSilent',
    playing ? 'pass' : 'fail',
    `getPlayerStatusEx.mode ${state.mode}, status ${state.status || 'unknown'}`,
    { input, status: state.status || 'unknown' }
  )
}

const outputCheck = (state: DeviceState): GuideCheck => {
  const hardware = state.outputHardware
  if (state.outputs.length === 0) {
    return check('outputsUnknown', 'unknown', 'getSoundCardModeSupportList missing')
  }
  if (hardware === null) {
    return check('outputUnknown', 'unknown', 'getNewAudioOutputHardwareMode.hardware missing')
  }
  const active = state.outputs.find(option => option.hardware === hardware) ?? null
  if (active === null) {
    return check('outputUnlisted', 'fail', `getNewAudioOutputHardwareMode.hardware ${hardware}`, {
      hardware,
    })
  }
  return check('output', 'pass', `getNewAudioOutputHardwareMode.hardware ${hardware}`, {
    active: active.name,
    available: state.outputs.map(option => option.name).join(', '),
  })
}

export const guideOrder: readonly GuideId[] = [
  'no-sound',
  'drops',
  'wrong-output',
  'cannot-join-group',
]

export const guideTitles: Record<GuideId, string> = {
  'no-sound': 'No sound',
  drops: 'It drops',
  'wrong-output': 'Wrong output',
  'cannot-join-group': 'Cannot join a group',
}

// Mute, volume and the sleep timer answer most of the "no sound" questions on
// their own, and they cost nothing: they already ride the poll. The source comes
// before the transport so an external input with no signal is named as such,
// instead of reading as the generic "the transport is stopped".
const noSound = (state: DeviceState): GuideCheck[] =>
  optional([
    offline(state),
    state.mute
      ? check('muted', 'fail', 'getPlayerStatusEx.mute 1')
      : check('unmuted', 'pass', 'getPlayerStatusEx.mute 0'),
    volumeCheck(state),
    state.sleepSeconds === null || state.sleepSeconds === 0
      ? check('sleepTimer', 'pass', 'getShutdown 0')
      : check('sleepTimerArmed', 'warn', `getShutdown ${state.sleepSeconds} s`, {
          minutes: Math.round(state.sleepSeconds / 60),
        }),
    sourceCheck(state),
    transportCheck(state),
    outputCheck(state),
    state.group.role === 'member' && state.group.members.length === 0
      ? check('groupNoMember', 'warn', 'multiroom:getSlaveList empty')
      : null,
  ])

const crashCount = (diagnostics: Diagnostics): number => {
  const counters = diagnostics.debug?.crashes ?? null
  if (counters === null) return 0
  return Object.values(counters).reduce<number>((total, value) => total + (value ?? 0), 0)
}

// The counters come from one command, so their absence is one anomaly: it stops
// the flow instead of letting the next checks read a state nobody measured.
const wifiCheck = (health: Diagnostics['health']): GuideCheck => {
  if (health === null) return check('counters', 'unknown', 'getNetworkHealth missing')
  const count = health.disconnected ?? 0
  if (count === 0) return check('wifiStable', 'pass', 'getNetworkHealth.disconnectedCount 0')
  return check('wifiDrops', 'warn', `getNetworkHealth.disconnectedCount ${health.disconnected}`, {
    count,
    minutes: health.lastMinutes ?? 0,
  })
}

const drops = (state: DeviceState, diagnostics: Diagnostics | null): GuideCheck[] => {
  const health = diagnostics?.health ?? null
  const counters = diagnostics === null ? 0 : crashCount(diagnostics)
  return optional([
    offline(state),
    // The link comes from the poll, so it is readable before the counters are.
    linkCheck(state),
    wifiCheck(health),
    health !== null && (health.pingFailures ?? 0) > 0
      ? check(
          'pingFailures',
          'warn',
          `getNetworkHealth.pingCheckFailedCount ${health.pingFailures}`,
          {
            count: health.pingFailures ?? 0,
          }
        )
      : null,
    health !== null && (health.ethDisconnected ?? 0) > 0
      ? check(
          'ethDrops',
          'warn',
          `getNetworkHealth.ethDisconnectedCount ${health.ethDisconnected}`,
          {
            count: health.ethDisconnected ?? 0,
          }
        )
      : null,
    // A reboot and a crash are not a network drop, and they change the answer:
    // the user is chasing the wrong cause.
    health !== null && (health.abnormalReboots ?? 0) > 0
      ? check(
          'abnormalReboots',
          'fail',
          `getNetworkHealth.wlanAbnormalRebootTimes ${health.abnormalReboots}`,
          { count: health.abnormalReboots ?? 0 }
        )
      : null,
    counters > 0
      ? check('crashCounters', 'fail', 'getDebugInfo crash counters', { count: counters })
      : null,
  ])
}

const wrongOutput = (state: DeviceState): GuideCheck[] => [offline(state), outputCheck(state)]

// The role the device claims decides the sentence: a saved group with nothing
// running is what a user reads as "my group disappeared", and a member with an
// empty list is the classic group failure.
const groupCheck = (state: DeviceState): GuideCheck => {
  const { role, name, members, saved } = state.group
  if (saved && role === 'none') {
    return check('groupSavedOnly', 'warn', `multiroom:getnamegrouplist ${name || 'unnamed'}`)
  }
  if (role === 'none') return check('groupNone', 'pass', 'getStatusEx.group 0')
  if (role === 'member' && members.length === 0) {
    return check('groupNoMember', 'warn', `multiroom:getSlaveList empty for ${name || 'a member'}`)
  }
  return check(
    role === 'master' ? 'groupMaster' : 'groupMember',
    'pass',
    `getStatusEx.group ${role}, ${members.length} member(s)`,
    { count: members.length }
  )
}

// A slave far from its master is the classic group failure, and a saved group
// with nothing running is what a user reads as "my group disappeared".
const groupChecks = (state: DeviceState): GuideCheck[] => {
  const wmrm = state.wmrmVersion
  return optional([
    offline(state),
    wmrm === ''
      ? check('groupCommandsMissing', 'unknown', 'getStatusEx.wmrm_version missing')
      : check('groupCommands', 'pass', `getStatusEx.wmrm_version ${wmrm}`, { version: wmrm }),
    groupCheck(state),
    linkCheck(state),
  ])
}

// The first check that is not a pass is the verdict, and it is also the last
// check of the flow: the reader gets the reasoning up to the anomaly, not a
// wall of green rows after it.
const run = (id: GuideId, candidates: GuideCheck[]): Guide => {
  const index = candidates.findIndex(entry => entry.status !== 'pass')
  if (index === -1) return { id, checks: candidates, verdict: null, settled: true }
  const checks = candidates.slice(0, index + 1)
  const verdict = candidates[index]
  return { id, checks, verdict, settled: verdict.status !== 'unknown' }
}

export const guidesFor = (input: {
  state: DeviceState
  diagnostics: Diagnostics | null
}): Guide[] => {
  const { state, diagnostics } = input
  const builders: Record<GuideId, () => GuideCheck[]> = {
    'no-sound': () => noSound(state),
    drops: () => drops(state, diagnostics),
    'wrong-output': () => wrongOutput(state),
    'cannot-join-group': () => groupChecks(state),
  }
  return guideOrder.map(id => run(id, builders[id]()))
}

// Only a check that is not a pass becomes a verdict, so only those ids need
// English wording here: the page carries every sentence, passes included, in its
// own languages. Writing wording for a check the report can never quote would
// be dead text that no test can honestly reach. A flow with nothing to report
// says so in `guideSection`, without quoting a row.
const verdictSentences: Record<string, (values: Record<string, string | number>) => string> = {
  offline: values => `The player does not answer: ${values.failures} consecutive poll failure(s).`,
  weakLink: values => `The radio link is weak: ${values.rssi} dBm, ${values.snr} dB SNR.`,
  muted: () => 'The player is muted.',
  volumeUnknown: () => 'The player did not report its volume.',
  lowVolume: values => `The volume is ${values.volume}: barely audible.`,
  noVolume: values => `The volume is ${values.volume}: nothing audible.`,
  sleepTimerArmed: values => `A sleep timer will stop the player in ${values.minutes} min.`,
  transportUnknown: () => 'The player did not report its transport state.',
  stopped: () => 'The transport is stopped: nothing is playing.',
  paused: () => 'The transport is paused.',
  externalSilent: values =>
    `The ${values.input} input is selected and it is not playing: no signal reaches the player.`,
  outputUnlisted: values =>
    `The active output (${values.hardware}) is not in the list the player reports.`,
  outputsUnknown: () => 'The player did not report its outputs.',
  outputUnknown: () => 'The player did not report its active output.',
  groupNoMember: () => 'This player is a group member and the group lists no member.',
  groupSavedOnly: () => 'A saved group exists but nothing runs on it.',
  groupCommandsMissing: () => 'The player does not report the group protocol version.',
  counters: () => 'The network counters are not read yet.',
  wifiDrops: values =>
    `The Wi-Fi dropped ${values.count} time(s), the last one ${values.minutes} min ago.`,
  pingFailures: values => `${values.count} ping check(s) failed.`,
  ethDrops: values => `The wired link dropped ${values.count} time(s).`,
  abnormalReboots: values => `The player rebooted abnormally ${values.count} time(s).`,
  crashCounters: values => `${values.count} crash counter(s) are non zero: the firmware restarted.`,
}

// A check added without its English wording must not throw in the report: the
// evidence is already a sentence a reader can act on.
const sentenceFor = (entry: GuideCheck): string => {
  const build = verdictSentences[entry.id]
  return build === undefined ? `${entry.id}: ${entry.evidence}` : build(entry.values)
}

// The report is English by design: one artefact, not one per language.
export const guideSection = (guides: Guide[]): string[] => {
  const lines = ['## Guided checks', '']
  for (const guide of guides) {
    const title = guideTitles[guide.id]
    const verdict = guide.verdict
    if (verdict === null) {
      lines.push(`- **${title}**: all ${guide.checks.length} check(s) passed.`)
      continue
    }
    const sentence = sentenceFor(verdict)
    const state = verdict.status === 'unknown' ? 'not read' : verdict.status
    lines.push(`- **${title}**: ${state} at \`${verdict.id}\`: ${sentence} (${verdict.evidence})`)
  }
  lines.push('')
  return lines
}
