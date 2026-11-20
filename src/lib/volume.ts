// The volume scale is 0-100 on every LinkPlay model the hub has met. A setting
// named `max_volume` looks like a cap but is not one (measured: a Mini reporting
// 40 accepted 54), so the scale is the only bound here, as in `server/`.

export const volumeMax = 100

// A drag lands on the coarse crank, the way the vendor app's dial clicks from
// mark to mark; the fine step is one.
export const volumeCrank = 5
export const volumeFine = 1

// Above this level a single stray crank becomes a physical event on a 100 W amp:
// the write is worth one confirmation.
export const loudLevel = 85

export const clampVolume = (level: number): number =>
  Math.min(volumeMax, Math.max(0, Math.round(level)))

// Half a crank rounds to the nearest one: the thumb never rests between two
// marks, and the readout never shows a level the next crank would skip.
export const crankVolume = (level: number): number =>
  clampVolume(Math.round(level / volumeCrank) * volumeCrank)

// A tap names a side of the thumb. It is read on the same 0-100 scale the levels
// use, so a tap a hair inside the thumb lands on the level itself and moves
// nothing: the gesture needs a side, not a distance.
export const tapSide = (level: number, ratio: number): -1 | 0 | 1 => {
  const mark = clampVolume(ratio * volumeMax)
  if (mark < level) return -1
  if (mark > level) return 1
  return 0
}

// The keyboard keeps both gestures reachable without a pointer: the arrows move
// one step, the page keys a whole crank, the ends go to the bounds. A key the
// scale does not own returns null and the browser keeps it (Tab, Escape).
export const keyVolume = (level: number, key: string): number | null => {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return clampVolume(level - volumeFine)
    case 'ArrowRight':
    case 'ArrowUp':
      return clampVolume(level + volumeFine)
    case 'PageDown':
      return clampVolume(level - volumeCrank)
    case 'PageUp':
      return clampVolume(level + volumeCrank)
    case 'Home':
      return 0
    case 'End':
      return volumeMax
    default:
      return null
  }
}

// Crossing the threshold from below asks once; a level already above it (one the
// reader confirmed a moment ago) moves freely, so a second crank does not ask
// twice for the same decision.
export const needsConfirmation = (from: number, to: number): boolean =>
  to > loudLevel && from <= loudLevel

// What a control hands its writes to: the inline gesture, the group fan-out and
// the pop-in all speak this shape.
export type VolumeLive = {
  onChange: (level: number) => void
  onRelease: (level: number) => void
  onCancel: () => void
}
