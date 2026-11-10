import { isRecord, num, parseJson, text } from './payload.ts'
import { resolveTarget } from './resolve.ts'
import { fetchCommand } from './transport.ts'

// The three probes behind the diagnostic findings, measured on the reference
// player on 09/11/2026. They change slowly, so they are refreshed on their own
// cadence instead of riding every poll.
export type Diagnostics = {
  at: number
  health: {
    disconnected: number | null
    ethDisconnected: number | null
    pingFailures: number | null
    abnormalReboots: number | null
    roaming: boolean
    band: number | null
    lastMessage: string
    lastMinutes: number | null
  } | null
  debug: {
    uptimeTicks: number | null
    crashes: {
      controller: number | null
      asrTts: number | null
      mcu: number | null
      deadlock: number | null
    }
    upnpActionsLost: number | null
    upnpActionsTotal: number | null
  } | null
  hardware: {
    ethError: boolean
    mfiError: boolean
    flashSpaceError: boolean
    soundCardError: boolean
    badBlocks: number | null
    totalBlocks: number | null
  } | null
}

// The probes are three separate commands and each answer is optional: a build
// that lacks one of them still yields the other two, so a finding is only ever
// dropped when its own source is silent.
// A pure seam: the three answers in, one `Diagnostics` out. `readDiagnostics`
// only adds the transport, which is what makes the payload shapes testable
// without a speaker.
export const parseDiagnostics = (
  raw: { health: string | null; debug: string | null; hardware: string | null },
  now = Date.now()
): Diagnostics | null => {
  const health = parseJson(raw.health)
  const debug = parseJson(raw.debug)
  const hardware = parseJson(raw.hardware)
  if (health === null && debug === null && hardware === null) return null
  const soundCard = isRecord(hardware?.soundCardHwError) ? hardware.soundCardHwError : null
  const lost = [0, 1, 2, 3].map(index => num(debug?.[`upnp_action_lost${index}`]))
  const total = [0, 1, 2, 3].map(index => num(debug?.[`upnp_action_total${index}`]))
  const sum = (values: Array<number | null>): number | null => {
    const known = values.filter((value): value is number => value !== null)
    return known.length === 0 ? null : known.reduce((acc, value) => acc + value, 0)
  }
  return {
    at: now,
    health:
      health === null
        ? null
        : {
            disconnected: num(health.disconnectedCount),
            ethDisconnected: num(health.ethDisconnectedCount),
            pingFailures: num(health.pingCheckFailedCount),
            abnormalReboots: num(health.wlanAbnormalRebootTimes),
            roaming: num(health.wlanRoamingOn) === 1,
            band: num(health.wlanBand),
            lastMessage: text(health.lastDisconnectedMsg).trim(),
            lastMinutes: num(health.lastDisconnectedTime),
          },
    debug:
      debug === null
        ? null
        : {
            uptimeTicks: num(debug.power_ticks),
            crashes: {
              controller: num(debug.a01controller_crash),
              asrTts: num(debug.asr_tts_crash),
              mcu: num(debug.mcu_crash),
              deadlock: num(debug.process_deadlock),
            },
            upnpActionsLost: sum(lost),
            upnpActionsTotal: sum(total),
          },
    hardware:
      hardware === null
        ? null
        : {
            ethError: num(hardware.ethError) === 1,
            mfiError: num(hardware.mfiChipError) === 1,
            flashSpaceError: num(hardware.flashSpaceError) === 1,
            soundCardError:
              soundCard === null ? false : Object.values(soundCard).some(value => num(value) === 1),
            badBlocks: num(hardware.badBlockNum),
            totalBlocks: num(hardware.totalBlockNum),
          },
  }
}

export const readDiagnostics = async (host: string): Promise<Diagnostics | null> => {
  const ip = resolveTarget(host)
  const [health, debug, hardware] = await Promise.all([
    fetchCommand(ip, 'getNetworkHealth'),
    fetchCommand(ip, 'getDebugInfo'),
    fetchCommand(ip, 'getHwErrorInfo'),
  ])
  return parseDiagnostics({ health, debug, hardware })
}
