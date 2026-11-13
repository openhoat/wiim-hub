import { describe, expect, test } from 'vitest'
import { presetInfo } from '../fixtures/wiim-pro.ts'
import { parsePresets } from './presets.ts'

describe('parsePresets', () => {
  test('reads an empty slot list as an empty list, not as a failure', () => {
    expect(parsePresets(presetInfo)).toEqual([])
  })

  test('answers null when the player does not know the command', () => {
    expect(parsePresets('unknown command')).toBeNull()
    expect(parsePresets('')).toBeNull()
    expect(parsePresets(null)).toBeNull()
  })

  test('orders the slots, names them and skips the unusable ones', () => {
    const raw = JSON.stringify({
      preset_num: 4,
      preset_list: [
        { number: 3, name: 'Jazz', picurl: 'https://example.test/3.jpg' },
        { number: 1, name: '', picurl: 'un_known' },
        { number: 0, name: 'Invalid' },
        { name: 'No number' },
        { number: 2, name: 'Rock', picurl: 'https://example.test/2.jpg' },
        'unknown command',
      ],
    })
    expect(parsePresets(raw)).toEqual([
      { number: 1, name: '1', artwork: '', source: '' },
      { number: 2, name: 'Rock', artwork: 'https://example.test/2.jpg', source: '' },
      { number: 3, name: 'Jazz', artwork: 'https://example.test/3.jpg', source: '' },
    ])
  })

  // Recorded on the reference player on 10/11/2026, after a playlist was saved
  // in the vendor app: the slot carries the service and a cover, and no stream
  // URL, because the player resolves the stream itself when the slot is played.
  test('keeps the service a slot was saved from', () => {
    const raw = JSON.stringify({
      preset_num: 1,
      preset_list: [
        {
          number: 4,
          name: 'Liked music',
          url: 'unknow',
          source: 'YouTubeMusic',
          picurl: 'https://www.gstatic.com/youtube/media/ytm/images/pbg/liked-songs-delhi-1200.png',
        },
      ],
    })
    expect(parsePresets(raw)).toEqual([
      {
        number: 4,
        name: 'Liked music',
        artwork: 'https://www.gstatic.com/youtube/media/ytm/images/pbg/liked-songs-delhi-1200.png',
        source: 'YouTubeMusic',
      },
    ])
  })
})
