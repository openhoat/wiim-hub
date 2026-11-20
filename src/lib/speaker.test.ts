import { describe, expect, test } from 'vitest'
import { quietTrack, speakerPlays, speakerVolume } from './speaker'

const text = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.slice(offset, offset + length))

const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

describe('the quiet track', () => {
  test('is a mono 16 bit WAV a browser can decode', () => {
    const bytes = quietTrack()
    const header = view(bytes)
    expect(text(bytes, 0, 4)).toBe('RIFF')
    expect(text(bytes, 8, 4)).toBe('WAVE')
    expect(text(bytes, 12, 4)).toBe('fmt ')
    expect(header.getUint16(20, true)).toBe(1)
    expect(header.getUint16(22, true)).toBe(1)
    expect(header.getUint32(24, true)).toBe(8000)
    expect(header.getUint32(28, true)).toBe(16000)
    expect(header.getUint16(34, true)).toBe(16)
    expect(text(bytes, 36, 4)).toBe('data')
    // Two seconds, and the sizes the header announces are the ones on disk.
    expect(header.getUint32(40, true)).toBe(32000)
    expect(bytes.byteLength).toBe(44 + 32000)
    expect(header.getUint32(4, true)).toBe(36 + 32000)
  })

  test('is quiet, and not silent: Chrome drops a tab that plays nothing', () => {
    const bytes = quietTrack()
    const header = view(bytes)
    const frames = header.getUint32(40, true) / 2
    let loudest = 0
    let nonZero = 0
    for (let frame = 0; frame < frames; frame += 1) {
      const sample = header.getInt16(44 + frame * 2, true)
      loudest = Math.max(loudest, Math.abs(sample))
      if (sample !== 0) nonZero += 1
    }
    expect(loudest).toBeLessThanOrEqual(8)
    expect(loudest).toBeGreaterThan(0)
    // A sine spends most of its samples away from zero, unlike a silence.
    expect(nonZero).toBeGreaterThan(frames / 2)
  })

  test('loops on a zero crossing, so the seam does not click', () => {
    const bytes = quietTrack()
    const header = view(bytes)
    const frames = header.getUint32(40, true) / 2
    expect(header.getInt16(44, true)).toBe(0)
    expect(header.getInt16(44 + (frames - 1) * 2, true)).toBe(-1)
    // One more frame of the same sine would be the first sample again.
    const next = Math.round(8 * Math.sin((2 * Math.PI * frames * 200) / 8000))
    expect(next).toBeCloseTo(0, 6)
  })

  test('is played below the speaker level the page applies', () => {
    expect(speakerVolume).toBeGreaterThan(0)
    expect(speakerVolume).toBeLessThan(1)
  })
})

describe('when the quiet track plays', () => {
  test('follows the transport of the published card', () => {
    expect(speakerPlays('play')).toBe(true)
    expect(speakerPlays('pause')).toBe(false)
    expect(speakerPlays('stop')).toBe(false)
    expect(speakerPlays('')).toBe(false)
  })
})
