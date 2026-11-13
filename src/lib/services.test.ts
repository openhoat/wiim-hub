import { describe, expect, test } from 'vitest'
import { isActive, levelLabel, orderServices, tierOf } from './services.ts'
import type { ServiceCapability } from './types.ts'

const service = (
  id: string,
  levels: string[],
  extra: Partial<ServiceCapability> = {}
): ServiceCapability => ({
  id,
  version: '1.0',
  levels,
  replayGain: false,
  configurable: false,
  active: false,
  ...extra,
})

describe('levelLabel', () => {
  test('prints a named level as published', () => {
    expect(levelLabel('Tidal', 'HI_RES')).toBe('HI_RES')
    expect(levelLabel('Pandora2', 'Medium')).toBe('MEDIUM')
    expect(levelLabel('Prime', 'UHD')).toBe('UHD')
  })

  test('translates the vendor enum that has a documented mapping', () => {
    expect(levelLabel('Qobuz', '6')).toBe('FLAC 16/44.1')
    expect(levelLabel('Qobuz', '27')).toBe('FLAC 24 ≤ 192 kHz')
  })

  test('leaves a numeric level alone where no source names its unit', () => {
    // An unknown family: a bare number is a vendor id, not a bitrate.
    expect(levelLabel('Mystery', '7')).toBe('7')
    expect(levelLabel('CalmRadio', '320')).toBe('320 kbps')
  })

  test('reads a token that carries its own codec and rate', () => {
    expect(levelLabel('KKBOX', 'flac_24_dash_cenc')).toBe('FLAC 24 bit')
    expect(levelLabel('KKBOX', 'aac_320_dash_cenc')).toBe('AAC 320 kbps')
    expect(levelLabel('Mystery', 'opus_160_web')).toBe('OPUS 160 kbps')
  })
})

describe('tierOf', () => {
  test('names the last level as the top tier', () => {
    expect(tierOf(service('Tidal', ['LOW', 'HIGH', 'LOSSLESS', 'HI_RES']))).toEqual({
      top: 'HI_RES',
      ladder: 'LOW < HIGH < LOSSLESS < HI_RES',
    })
  })

  test('answers nothing for a family that publishes no level', () => {
    expect(tierOf(service('SpotifyConnect', []))).toBeNull()
  })

  test('translates the whole ladder, not only its top', () => {
    expect(tierOf(service('Qobuz', ['5', '6', '7', '27']))).toEqual({
      top: 'FLAC 24 ≤ 192 kHz',
      ladder: 'MP3 320 < FLAC 16/44.1 < FLAC 24 ≤ 96 kHz < FLAC 24 ≤ 192 kHz',
    })
  })
})

describe('ordering', () => {
  const table = [
    service('newTuneIn', []),
    service('Tidal', ['LOW', 'HIGH']),
    service('SpotifyConnect', [], { configurable: true }),
    service('Deezer2', ['LOW', 'LOSSLESS']),
  ]

  test('puts what is playing first, then what publishes a tier', () => {
    expect(orderServices(table, 'spotifyconnect').map(entry => entry.id)).toEqual([
      'SpotifyConnect',
      'Deezer2',
      'Tidal',
      'newTuneIn',
    ])
  })

  test('keeps a stable order without an active service', () => {
    expect(orderServices(table, '').map(entry => entry.id)).toEqual([
      'Deezer2',
      'Tidal',
      'newTuneIn',
      'SpotifyConnect',
    ])
  })

  test('matches the playing service whatever its case', () => {
    expect(isActive(service('YouTubeMusic', []), 'youtubemusic')).toBe(true)
    expect(isActive(service('Tidal', []), '')).toBe(false)
  })
})
