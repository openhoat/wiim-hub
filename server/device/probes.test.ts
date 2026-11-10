import { describe, expect, it, vi } from 'vitest'

// The probe cache is the only part of the device client that remembers a
// negative answer, so it is tested against a fake wire: `fetchCommand` is the
// seam, and what the module decides to ask (or not) is what matters here.
vi.mock('./transport.ts', () => ({ fetchCommand: vi.fn() }))

import { isUnsupportedAnswer, probeCacheTtlMs, probeCommand, probeDue, probeKey } from './probes.ts'
import { fetchCommand } from './transport.ts'

const wire = vi.mocked(fetchCommand)

describe('probeKey', () => {
  it('separates two players that report the same firmware', () => {
    const one = probeKey('192.0.2.10', 'Linkplay.4.8.833748', 'getPresetInfo')
    const other = probeKey('192.0.2.11', 'Linkplay.4.8.833748', 'getPresetInfo')
    expect(one).not.toBe(other)
    expect(one).toBe('192.0.2.10|Linkplay.4.8.833748|getPresetInfo')
  })

  it('separates two builds of one player', () => {
    expect(probeKey('192.0.2.10', 'Linkplay.4.8.1', 'EQGetList')).not.toBe(
      probeKey('192.0.2.10', 'Linkplay.4.8.833748', 'EQGetList')
    )
  })
})

describe('isUnsupportedAnswer', () => {
  it('recognises the token the firmware sends, in any case and with padding', () => {
    expect(isUnsupportedAnswer('unknown command')).toBe(true)
    expect(isUnsupportedAnswer('  Unknown Command\n')).toBe(true)
  })

  it('does not read a real answer or a silence as a capability verdict', () => {
    expect(isUnsupportedAnswer('OK')).toBe(false)
    expect(isUnsupportedAnswer('{ "preset_list": [] }')).toBe(false)
    // A null is a missed request, not a build that lacks the command: caching
    // it would hide the feature for a day after one dropped packet.
    expect(isUnsupportedAnswer(null)).toBe(false)
  })
})

describe('probeDue', () => {
  it('is due when the command was never asked', () => {
    expect(probeDue(undefined, 1000)).toBe(true)
  })

  it('is silent inside the window and due again at its edge', () => {
    expect(probeDue(1000, 1000 + probeCacheTtlMs - 1)).toBe(false)
    expect(probeDue(1000, 1000 + probeCacheTtlMs)).toBe(true)
  })

  it('takes the window as an argument, so a slow probe can share its own', () => {
    expect(probeDue(1000, 2000, 1000)).toBe(true)
    expect(probeDue(1000, 1999, 1000)).toBe(false)
  })
})

describe('probeCommand', () => {
  it('asks once and stops asking a build that answered unknown command', async () => {
    wire.mockResolvedValueOnce('unknown command')
    expect(await probeCommand('192.0.2.20', 'fw-a', 'getPresetInfo')).toBe('unknown command')
    // The second call is suppressed: `null` is what every parser reads as "no
    // answer", so the cached value stays.
    expect(await probeCommand('192.0.2.20', 'fw-a', 'getPresetInfo')).toBeNull()
    expect(wire).toHaveBeenCalledTimes(1)
  })

  it('keeps asking after an answer that is not a verdict on the build', async () => {
    wire.mockResolvedValueOnce('OK').mockResolvedValueOnce('Failed')
    expect(await probeCommand('192.0.2.21', 'fw-a', 'LED_SWITCH_GET')).toBe('OK')
    expect(await probeCommand('192.0.2.21', 'fw-a', 'LED_SWITCH_GET')).toBe('Failed')
    expect(wire).toHaveBeenCalledTimes(2)
  })

  it('asks again after a firmware update, in the same process', async () => {
    wire.mockResolvedValueOnce('unknown command').mockResolvedValueOnce('{ "RC": {} }')
    expect(await probeCommand('192.0.2.22', 'fw-old', 'GetAcousticCapability')).toBe(
      'unknown command'
    )
    // The new build gets its own key, so the negative answer of the old one
    // does not outlive the update.
    expect(await probeCommand('192.0.2.22', 'fw-new', 'GetAcousticCapability')).toBe('{ "RC": {} }')
    expect(wire).toHaveBeenCalledTimes(2)
  })
})
