import { describe, expect, it } from 'vitest'
import { parseDiagnostics } from './device/diagnostics.ts'

// The payloads below are the reference player's own answers, trimmed to the
// fields the diagnostics read (2026-11-09). They are recorded verbatim, numbers
// as numbers and strings as strings, because that mixed typing is exactly what
// broke the first version of the counter reader: `getStatusEx` answers strings,
// `getNetworkHealth` and `getHwErrorInfo` answer numbers.
const health = JSON.stringify({
  wlanDhcpTime: 2,
  ethDhcpTime: 0,
  wlanIpChanged: 0,
  wlanRoamingOn: 0,
  wlanBand: 1,
  wlanHistoryNum: 2,
  disconnectedCount: 2,
  lastDisconnectedTime: 14,
  ethDisconnectedCount: 1,
  lastDisconnectedMsg:
    '2026-11-09 10:57:00 <3>CTRL-EVENT-DISCONNECTED bssid=3a:07:16:fa:ee:18 reason=3',
  ethNotReady: 0,
  pingCheckFailedCount: 0,
  wlanConnectTime: 11,
  wlanAbnormalRebootTimes: 0,
  wlanIsStaticIp: 0,
  ethIsStaticIp: 0,
})

const debug = JSON.stringify({
  system_ready: '1',
  play_status: '0',
  a01controller_crash: '0',
  asr_tts_crash: '0',
  mcu_crash: '0',
  process_deadlock: '0',
  power_ticks: '57792324',
  upnp_action_total0: '456',
  upnp_action_remain0: '0',
  upnp_action_lost0: '0',
  upnp_action_total1: '0',
  upnp_action_lost1: '0',
})

const hardware = JSON.stringify({
  ethError: 0,
  hostError: 0,
  mfiChipError: 0,
  flashSpaceError: 0,
  badBlockNum: 5,
  totalBlockNum: 2000,
  soundCardHwError: { pcm5121: 0 },
})

const unknown = 'unknown command'

describe('parseDiagnostics', () => {
  it('reads the counters the device sends as numbers', () => {
    const parsed = parseDiagnostics({ health, debug, hardware }, 1)
    expect(parsed?.at).toBe(1)
    expect(parsed?.health).toEqual({
      disconnected: 2,
      ethDisconnected: 1,
      pingFailures: 0,
      abnormalReboots: 0,
      roaming: false,
      band: 1,
      lastMessage:
        '2026-11-09 10:57:00 <3>CTRL-EVENT-DISCONNECTED bssid=3a:07:16:fa:ee:18 reason=3',
      lastMinutes: 14,
    })
    expect(parsed?.hardware).toEqual({
      ethError: false,
      mfiError: false,
      flashSpaceError: false,
      soundCardError: false,
      badBlocks: 5,
      totalBlocks: 2000,
    })
  })

  it('reads the counters the same build sends as strings', () => {
    // `power_ticks` and the UPnP action counters are quoted on this firmware,
    // and the absent slots report nothing rather than zero: a sum over the
    // known slots must not read the missing ones as a loss.
    const parsed = parseDiagnostics({ health, debug, hardware }, 1)
    expect(parsed?.debug).toEqual({
      uptimeTicks: 57_792_324,
      crashes: { controller: 0, asrTts: 0, mcu: 0, deadlock: 0 },
      upnpActionsLost: 0,
      upnpActionsTotal: 456,
    })
  })

  it('turns a hardware flag into a fault', () => {
    const flagged = JSON.stringify({ ethError: 1, badBlockNum: 40, totalBlockNum: 2000 })
    expect(parseDiagnostics({ health, debug, hardware: flagged }, 1)?.hardware?.ethError).toBe(true)
    const soundCard = JSON.stringify({ soundCardHwError: { pcm5121: 1 } })
    expect(
      parseDiagnostics({ health, debug, hardware: soundCard }, 1)?.hardware?.soundCardError
    ).toBe(true)
  })

  it('keeps the sources that answered when one of them is unsupported', () => {
    const parsed = parseDiagnostics({ health, debug, hardware: unknown }, 1)
    expect(parsed?.hardware).toBeNull()
    expect(parsed?.health?.disconnected).toBe(2)
    expect(parsed?.debug?.uptimeTicks).toBe(57_792_324)
  })

  it('reports nothing at all when none of the three answers', () => {
    expect(parseDiagnostics({ health: unknown, debug: '', hardware: unknown })).toBeNull()
  })

  it('keeps an unknown counter null instead of turning it into zero', () => {
    const partial = JSON.stringify({ disconnectedCount: 0 })
    const parsed = parseDiagnostics({ health: partial, debug: unknown, hardware: unknown }, 1)
    expect(parsed?.health?.disconnected).toBe(0)
    expect(parsed?.health?.ethDisconnected).toBeNull()
    expect(parsed?.health?.lastMinutes).toBeNull()
    expect(parsed?.health?.lastMessage).toBe('')
  })
})
