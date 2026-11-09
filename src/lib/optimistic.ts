import type { Action } from './api'
import type { Device } from './types'

// The hub polls every few seconds, so a control that waits for the next poll
// feels broken. A write paints the expected value immediately, keeps it for a
// short window, and drops it as soon as a poll newer than the write lands: the
// device always has the last word.
//
// Both halves are pure and live here, away from the hook, so the rule can be
// tested without a browser (`src/lib/optimistic.test.ts`).

export type Override = Partial<
  Pick<
    Device,
    | 'volume'
    | 'mute'
    | 'status'
    | 'curposMs'
    | 'totalMs'
    | 'input'
    | 'sleepSeconds'
    | 'outputHardware'
  >
> & { eq?: Partial<Device['eq']> }

export const overrideLifetimeMs = 6000

export const optimisticFor = (device: Device, action: Action): Override => {
  switch (action.action) {
    case 'play':
      return { status: 'play' }
    case 'pause':
      return { status: 'pause' }
    case 'toggle':
      return { status: device.status === 'play' ? 'pause' : 'play' }
    case 'stop':
      return { status: 'stop' }
    case 'next':
    case 'prev':
      return { status: 'load', curposMs: 0 }
    case 'seek': {
      const target = action.seconds * 1000
      const ceiling = device.totalMs !== null && device.totalMs > 0 ? device.totalMs : target
      return { curposMs: Math.min(target, ceiling) }
    }
    case 'volume':
      return { volume: action.level, mute: false }
    case 'mute':
      return { mute: action.muted }
    case 'source':
      return { input: action.input }
    case 'sleep':
      return { sleepSeconds: action.seconds }
    case 'output':
      return { outputHardware: action.hardware }
    case 'eq':
      return { eq: { enabled: action.enabled } }
    case 'eqPreset':
      // The curve of the named preset is not known to the browser: the next
      // poll brings it, and the name is enough to confirm the click landed.
      return { eq: { name: action.name } }
    case 'eqBand': {
      // A hand-moved band drops the factory name on the device: paint that too,
      // so the curve stops claiming to be `Rock` the instant it stops being it.
      const bands = device.eq.bands.map(band =>
        band.name === action.band ? { ...band, value: action.value } : band
      )
      return { eq: { bands, name: '' } }
    }
    default:
      return {}
  }
}

// The window is checked again on render, not only by the timer: a tab that was
// asleep must not repaint a value the device has long forgotten, and the caller
// passes `now` so the rule stays pure.
export const withOverride = (
  device: Device,
  painted: { value: Override; at: number } | null,
  now: number
): Device => {
  if (painted === null || now - painted.at >= overrideLifetimeMs) return device
  // `eq` is an object of its own: merging it like a scalar field would drop the
  // curve as soon as a single flag was painted.
  const { eq: eqPatch, ...rest } = painted.value
  return {
    ...device,
    ...rest,
    eq: eqPatch === undefined ? device.eq : { ...device.eq, ...eqPatch },
  }
}
