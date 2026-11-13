import { describe, expect, test } from 'vitest'
import { inputCapability, inputEnable, modeRename, outputList } from '../fixtures/wiim-pro.ts'
import { parseCapability } from './inputs.ts'

describe('parseCapability', () => {
  test('reads the inputs, the labels and the outputs of the recorded answers', () => {
    expect(
      parseCapability({
        inputs: inputCapability,
        enable: inputEnable,
        rename: modeRename,
        outputs: outputList,
      })
    ).toEqual({
      inputs: ['wifi', 'line-in', 'bluetooth', 'optical'],
      // This model answers `Failed` when asked to rename an input.
      inputLabels: {},
      outputs: [
        { hardware: 1, name: 'Optical Out' },
        { hardware: 2, name: 'Line Out' },
        { hardware: 3, name: 'COAX Out' },
      ],
    })
  })

  test('adds an input the user enabled but the capability list missed', () => {
    const parsed = parseCapability({
      inputs: JSON.stringify({ audioInput: [{ mode: 'wifi' }] }),
      enable: JSON.stringify({
        audioInput: [
          { mode: 'wifi', enable: 1 },
          { mode: 'optical', enable: 1 },
          { mode: 'bluetooth', enable: 0 },
        ],
      }),
      rename: JSON.stringify({ optical: 'TV' }),
      outputs: 'unknown command',
    })
    expect(parsed).toEqual({
      inputs: ['wifi', 'optical'],
      inputLabels: { optical: 'TV' },
      outputs: [],
    })
  })

  test('answers nothing rather than an empty panel when no answer is readable', () => {
    expect(
      parseCapability({ inputs: 'unknown command', enable: null, rename: '', outputs: '' })
    ).toBeNull()
  })
})
