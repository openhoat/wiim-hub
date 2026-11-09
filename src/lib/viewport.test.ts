import { describe, expect, it } from 'vitest'
import { keyboardInset, visibleHeight } from './viewport.ts'

const viewport = (height: number, offsetTop = 0, scale = 1) => ({ height, offsetTop, scale })

describe('keyboardInset', () => {
  it('answers nothing while the keyboard is closed', () => {
    expect(keyboardInset(800, viewport(800))).toBe(0)
  })

  it('answers nothing when the browser resized the layout viewport', () => {
    // Chrome on Android with `interactive-widget=resizes-content`: the window
    // already lost the height the keyboard takes, so the sheet is above it.
    expect(keyboardInset(500, viewport(500))).toBe(0)
  })

  it('measures a keyboard the browser only painted over', () => {
    // The default on Android: the window keeps its height, the visual viewport
    // shrinks, so the bottom of the sheet is behind the keyboard.
    expect(keyboardInset(800, viewport(500))).toBe(300)
  })

  it('accounts for a page the browser scrolled to reveal the field', () => {
    expect(keyboardInset(800, viewport(500, 120))).toBe(180)
  })

  it('leaves a zoomed page alone', () => {
    expect(keyboardInset(800, viewport(400, 0, 2))).toBe(0)
  })

  it('never answers a negative inset', () => {
    expect(keyboardInset(800, viewport(760, 80))).toBe(0)
  })

  it('rounds to whole pixels', () => {
    expect(keyboardInset(800, viewport(499.4))).toBe(301)
  })
})

describe('visibleHeight', () => {
  it('reads the visual viewport when the engine has one', () => {
    expect(visibleHeight(800, { height: 499.6, scale: 1 })).toBe(500)
  })

  it('falls back to the window, and ignores a zoom', () => {
    expect(visibleHeight(800, null)).toBe(800)
    expect(visibleHeight(800, { height: 400, scale: 2 })).toBe(800)
  })
})
