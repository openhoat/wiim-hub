import { describe, expect, test } from 'vitest'
import { clampVolume, crankVolume, keyVolume, needsConfirmation, tapSide } from './volume'

describe('volume scale', () => {
  test('clamps to the 0-100 scale, whatever the setting says', () => {
    expect(clampVolume(-3)).toBe(0)
    expect(clampVolume(101)).toBe(100)
    expect(clampVolume(42.4)).toBe(42)
    expect(clampVolume(42.6)).toBe(43)
  })

  test('lands a drag on the nearest crank', () => {
    expect(crankVolume(42)).toBe(40)
    expect(crankVolume(43)).toBe(45)
    expect(crankVolume(-2)).toBe(0)
    expect(crankVolume(99)).toBe(100)
  })

  test('reads the side of a tap on the scale, not on a distance', () => {
    expect(tapSide(42, 0.2)).toBe(-1)
    expect(tapSide(42, 0.7)).toBe(1)
    expect(tapSide(42, 0.42)).toBe(0)
    // A tap in the last hundredth still names a side: the gesture is a side.
    expect(tapSide(100, 0.99)).toBe(-1)
    expect(tapSide(0, 0)).toBe(0)
    expect(tapSide(100, 1)).toBe(0)
  })

  test('moves one step with the arrows and a crank with the page keys', () => {
    expect(keyVolume(42, 'ArrowRight')).toBe(43)
    expect(keyVolume(42, 'ArrowUp')).toBe(43)
    expect(keyVolume(0, 'ArrowLeft')).toBe(0)
    expect(keyVolume(100, 'ArrowRight')).toBe(100)
    expect(keyVolume(42, 'PageUp')).toBe(47)
    expect(keyVolume(42, 'PageDown')).toBe(37)
    expect(keyVolume(42, 'Home')).toBe(0)
    expect(keyVolume(42, 'End')).toBe(100)
    expect(keyVolume(42, 'Tab')).toBeNull()
  })

  test('asks only when a gesture crosses the threshold upwards', () => {
    expect(needsConfirmation(84, 86)).toBe(true)
    expect(needsConfirmation(85, 86)).toBe(true)
    expect(needsConfirmation(86, 88)).toBe(false)
    expect(needsConfirmation(84, 85)).toBe(false)
  })
})
