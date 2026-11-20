import { describe, expect, test } from 'vitest'
import { quietTrack, speakerPlays, speakerVolume } from './speaker'

const text = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.slice(offset, offset + length))

const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

// The line Chrome draws between a silent stream and a page that plays:
// kSilenceThresholdDBFS in services/audio/output_stream.cc.
const silenceThresholdDbfs = -72.24719896

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
    // Thirty seconds, and the sizes the header announces are the ones in memory.
    expect(header.getUint32(40, true)).toBe(480000)
    expect(bytes.byteLength).toBe(44 + 480000)
    expect(header.getUint32(4, true)).toBe(36 + 480000)
  })

  test('lasts long enough for chrome to treat the tab as a player', () => {
    const header = view(quietTrack())
    const frames = header.getUint32(40, true) / 2
    const seconds = frames / header.getUint32(24, true)
    // Measured on Chrome for Android: two seconds at the same level showed no
    // lock screen player, thirty seconds showed one every time. The threshold
    // sits between the two, so the track keeps a wide margin over it.
    expect(seconds).toBeGreaterThanOrEqual(30)
  })

  test('clears the silence detector that decides whether a tab is a player', () => {
    const bytes = quietTrack()
    const header = view(bytes)
    const frames = header.getUint32(40, true) / 2
    let sum = 0
    let loudest = 0
    for (let frame = 0; frame < frames; frame += 1) {
      const sample = header.getInt16(44 + frame * 2, true)
      sum += sample * sample
      loudest = Math.max(loudest, Math.abs(sample))
    }
    const level = (gain: number): number =>
      10 * Math.log10((sum / frames / (32768 * 32768)) * gain * gain)
    // Ten decibels of margin, whichever side of the mixer the meter reads: a
    // stream under the line is silence, and silence is the bug this track fixes.
    expect(level(1)).toBeGreaterThan(silenceThresholdDbfs + 10)
    expect(level(speakerVolume)).toBeGreaterThan(silenceThresholdDbfs + 10)
    // A sine spends most of its samples away from zero, unlike a silence.
    expect(loudest).toBeGreaterThan(0)
    // Still a whisper of full scale, and far below the band a phone renders.
    expect(loudest / 32768).toBeLessThan(0.01)
  })

  test('loops on a zero crossing, so the seam does not click', () => {
    const bytes = quietTrack()
    const header = view(bytes)
    const frames = header.getUint32(40, true) / 2
    expect(header.getInt16(44, true)).toBe(0)
    // The last frame is one sample short of closing the cycle, and the frame
    // after it would be the first sample again.
    expect(Math.abs(header.getInt16(44 + (frames - 1) * 2, true))).toBeLessThan(12)
    expect(Math.round(260 * Math.sin((2 * Math.PI * frames * 40) / 8000))).toBeCloseTo(0, 6)
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
