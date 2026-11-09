// A sheet pinned to the bottom of the window disappears behind the on-screen
// keyboard on a phone: the keyboard covers the bottom half of the screen, the
// sheet stays where it was, and the form it holds is exactly what the reader
// wanted to type into.
//
// There are two ways out and browsers disagree on which one they take. Chrome
// on Android, by default, keeps the layout viewport at full height and shrinks
// only what is shown, so `position: fixed; bottom: 0` does not move. `index.html`
// asks for the other behaviour (`interactive-widget=resizes-content`), where the
// page itself is resized; engines that ignore the hint still shrink the visual
// viewport. This module measures both numbers and publishes them as
// `--keyboard-inset` and `--visible-height`, so the sheet follows one rule
// whatever happened.
export const KEYBOARD_INSET = '--keyboard-inset'
export const VISIBLE_HEIGHT = '--visible-height'

// How much of the window's height the keyboard takes at the bottom. When the
// browser resized the layout viewport, `innerHeight` already lost that height
// and the answer is zero: the hint and the measurement never add up.
export const keyboardInset = (
  innerHeight: number,
  viewport: { height: number; offsetTop: number; scale: number }
): number => {
  // A pinch zoom moves the visual viewport for reasons that have nothing to do
  // with a keyboard; moving the sheet then would be wrong.
  if (viewport.scale !== 1) return 0
  const inset = innerHeight - viewport.height - viewport.offsetTop
  return inset > 0 ? Math.round(inset) : 0
}

// What is actually visible. The sheet caps its height on this rather than on a
// viewport unit, because an engine that paints the keyboard over the page does
// not shrink any viewport unit.
export const visibleHeight = (
  innerHeight: number,
  viewport: { height: number; scale: number } | null
): number => {
  // A pinch zoom shrinks the visual viewport for a reason that has nothing to
  // do with a keyboard, and a zoom on a phone is the reader's own doing: the
  // window is then the honest answer.
  if (viewport?.scale !== 1) return Math.round(innerHeight)
  return Math.round(viewport.height)
}

// Written on the root element so the stylesheet can read them, and re-measured
// on every change of the visual viewport: the keyboard opens, closes, and the
// page scrolls under it.
export const watchKeyboard = (): (() => void) => {
  const viewport = window.visualViewport
  const root = document.documentElement
  let painted = ''
  const apply = (): void => {
    const inset = viewport === null ? 0 : keyboardInset(window.innerHeight, viewport)
    const height = visibleHeight(window.innerHeight, viewport)
    const next = `${inset}px ${height}px`
    // A scroll of the visual viewport fires often and usually changes nothing:
    // writing the same value back would only cost a style recalculation.
    if (next === painted) return
    painted = next
    root.style.setProperty(KEYBOARD_INSET, `${inset}px`)
    root.style.setProperty(VISIBLE_HEIGHT, `${height}px`)
  }
  apply()
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
  viewport?.addEventListener('resize', apply)
  viewport?.addEventListener('scroll', apply)
  return () => {
    window.removeEventListener('resize', apply)
    window.removeEventListener('orientationchange', apply)
    viewport?.removeEventListener('resize', apply)
    viewport?.removeEventListener('scroll', apply)
  }
}
