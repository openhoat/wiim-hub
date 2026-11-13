import { describe, expect, test } from 'vitest'
import { acousticCapability, eqList } from '../fixtures/wiim-pro.ts'
import { parseAcoustic } from './acoustic.ts'

describe('parseAcoustic', () => {
  test('reads the factory curves and the room-correction capability', () => {
    const parsed = parseAcoustic({ presets: eqList, capability: acousticCapability }, null)
    expect(parsed.roomFit).toBe(true)
    expect(parsed.presets).toHaveLength(24)
    expect(parsed.presets[0]).toBe('Flat')
    expect(parsed.presets).toContain('Small Speakers')
  })

  test('keeps each field the last good probe knew when an answer is unreadable', () => {
    const cached = { presets: ['Rock'], roomFit: true }
    expect(
      parseAcoustic({ presets: 'unknown command', capability: 'unknown command' }, cached)
    ).toEqual(cached)
    // An answer that lists no room correction does not erase a capability the
    // same player advertised before: only a probe with nothing cached starts
    // closed, and that is the test below.
    expect(
      parseAcoustic({ presets: eqList, capability: '{"Version":"1.0"}' }, cached).roomFit
    ).toBe(true)
    expect(parseAcoustic({ presets: eqList, capability: '{"Version":"1.0"}' }, null).roomFit).toBe(
      false
    )
  })

  test('starts empty when nothing was ever probed', () => {
    expect(parseAcoustic({ presets: null, capability: null }, null)).toEqual({
      presets: [],
      roomFit: false,
    })
  })
})
