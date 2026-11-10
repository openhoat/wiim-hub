import { describe, expect, it } from 'vitest'
import { isExternalInput, positionMs } from './status.ts'

describe('isExternalInput', () => {
  it('treats the analogue and optical inputs as sources without a track', () => {
    expect(isExternalInput('optical')).toBe(true)
    expect(isExternalInput('line-in')).toBe(true)
  })

  it('leaves the network playlist and the unmeasured inputs alone', () => {
    expect(isExternalInput('wifi')).toBe(false)
    expect(isExternalInput('bluetooth')).toBe(false)
    expect(isExternalInput('')).toBe(false)
  })
})

describe('positionMs', () => {
  it('keeps the milliseconds a source below the frontier already reports', () => {
    expect(positionMs(49_489, 'wifi')).toBe(49_489)
  })

  it('reads a position above ten hours as microseconds', () => {
    expect(positionMs(60_000_000, 'wifi')).toBe(60_000)
    expect(positionMs(180_000_000, '')).toBe(180_000)
  })

  it('keeps milliseconds on a known local source, whatever the value', () => {
    // A ten hour audiobook on a key would otherwise read as a few seconds.
    expect(positionMs(36_500_000, 'udisk')).toBe(36_500_000)
    expect(positionMs(45_000_000, 'HDMI')).toBe(45_000_000)
  })

  it('treats the frontier itself as milliseconds', () => {
    expect(positionMs(36_000_000, 'wifi')).toBe(36_000_000)
  })

  it('leaves an absent or zero position alone', () => {
    expect(positionMs(null, 'wifi')).toBeNull()
    expect(positionMs(0, 'wifi')).toBe(0)
  })
})
