import { describe, expect, test } from 'vitest'
import { formatClock, formatDuration, formatNumber, positionOf } from './format'

describe('formatDuration', () => {
  test('prints minutes and seconds below an hour', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(-1)).toBe('0:00')
  })

  test('adds the hour field only when there is one', () => {
    expect(formatDuration(3_725_000)).toBe('1:02:05')
  })
})

describe('formatNumber', () => {
  test('groups the way each language writes it', () => {
    expect(formatNumber(1234, 'en')).toBe('1,234')
    expect(formatNumber(1234, 'fr')).toBe('1\u00a0234')
    expect(formatNumber(2.5, 'fr')).toBe('2,5')
    expect(formatNumber(-55, 'en')).toBe('-55')
  })
})

describe('formatClock', () => {
  test('reads the clock in the selected language', () => {
    const at = Date.UTC(2026, 0, 2, 13, 4, 5)
    // French keeps a 24 hour clock, English does not: the two must not agree.
    expect(formatClock(at, 'fr')).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(formatClock(at, 'en')).not.toBe(formatClock(at, 'fr'))
  })
})

describe('positionOf', () => {
  const device = { curposMs: 10_000, totalMs: 60_000, status: 'play', updatedAt: 1_000 }

  test('extrapolates a playing device from its last poll', () => {
    expect(positionOf(device, 4_000)).toBe(13_000)
  })

  test('holds a paused device where it stopped', () => {
    expect(positionOf({ ...device, status: 'pause' }, 4_000)).toBe(10_000)
  })

  test('never runs past the end of the track', () => {
    expect(positionOf(device, 600_000)).toBe(60_000)
  })

  test('has nothing to show without a position', () => {
    expect(positionOf({ ...device, curposMs: null }, 4_000)).toBeNull()
    expect(positionOf({ ...device, totalMs: null }, 4_000)).toBeNull()
  })
})
