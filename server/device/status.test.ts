import { describe, expect, test } from 'vitest'
import { inputFromMode, isExternalInput, positionMs } from './status.ts'

describe('inputFromMode', () => {
  test('reads the device playlist as the wifi input', () => {
    expect(inputFromMode('10')).toBe('wifi')
    expect(inputFromMode('19')).toBe('wifi')
  })

  test('reads a cast and the streaming services as the wifi input too', () => {
    // Measured on the reference player while casting: mode 5, vendor CAST.
    expect(inputFromMode('5')).toBe('wifi')
    expect(inputFromMode('31')).toBe('wifi')
    expect(inputFromMode('32')).toBe('wifi')
    expect(inputFromMode('36')).toBe('wifi')
  })

  test('keeps the analogue and digital inputs on their own ids', () => {
    expect(inputFromMode('40')).toBe('line-in')
    expect(inputFromMode('41')).toBe('bluetooth')
    expect(inputFromMode('43')).toBe('optical')
  })

  test('leaves an unknown, absent or idle mode unnamed', () => {
    expect(inputFromMode('9')).toBe('')
    expect(inputFromMode('99')).toBe('')
    expect(inputFromMode('')).toBe('')
  })
})

describe('isExternalInput', () => {
  test('treats the analogue and optical inputs as sources without a track', () => {
    expect(isExternalInput('optical')).toBe(true)
    expect(isExternalInput('line-in')).toBe(true)
  })

  test('leaves the network playlist and the unmeasured inputs alone', () => {
    expect(isExternalInput('wifi')).toBe(false)
    expect(isExternalInput('bluetooth')).toBe(false)
    expect(isExternalInput('')).toBe(false)
  })
})

describe('positionMs', () => {
  test('keeps the milliseconds a source below the frontier already reports', () => {
    expect(positionMs(49_489, 'wifi')).toBe(49_489)
  })

  test('reads a position above ten hours as microseconds', () => {
    expect(positionMs(60_000_000, 'wifi')).toBe(60_000)
    expect(positionMs(180_000_000, '')).toBe(180_000)
  })

  test('keeps milliseconds on a known local source, whatever the value', () => {
    // A ten hour audiobook on a key would otherwise read as a few seconds.
    expect(positionMs(36_500_000, 'udisk')).toBe(36_500_000)
    expect(positionMs(45_000_000, 'HDMI')).toBe(45_000_000)
  })

  test('treats the frontier itself as milliseconds', () => {
    expect(positionMs(36_000_000, 'wifi')).toBe(36_000_000)
  })

  test('leaves an absent or zero position alone', () => {
    expect(positionMs(null, 'wifi')).toBeNull()
    expect(positionMs(0, 'wifi')).toBe(0)
  })
})
