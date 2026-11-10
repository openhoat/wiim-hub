import { describe, expect, it } from 'vitest'
import { presetInfo } from '../fixtures/wiim-pro.ts'
import { parsePresets } from './presets.ts'

describe('parsePresets', () => {
  it('reads an empty slot list as an empty list, not as a failure', () => {
    expect(parsePresets(presetInfo)).toEqual([])
  })

  it('answers null when the player does not know the command', () => {
    expect(parsePresets('unknown command')).toBeNull()
    expect(parsePresets('')).toBeNull()
    expect(parsePresets(null)).toBeNull()
  })

  it('orders the slots, names them and skips the unusable ones', () => {
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
      { number: 1, name: '1', artwork: '' },
      { number: 2, name: 'Rock', artwork: 'https://example.test/2.jpg' },
      { number: 3, name: 'Jazz', artwork: 'https://example.test/3.jpg' },
    ])
  })
})
