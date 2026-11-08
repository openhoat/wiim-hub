import { useCallback, useEffect, useRef, useState } from 'react'
import { sendCommand, type Action } from './api'
import type { Device } from './types'

// The hub polls every few seconds, so a control that waits for the next poll
// feels broken. A write paints the expected value immediately, keeps it for a
// short window, and drops it as soon as a poll newer than the write lands: the
// device always has the last word.
type Override = Partial<
  Pick<
    Device,
    'volume' | 'mute' | 'status' | 'curposMs' | 'totalMs' | 'input' | 'sleepSeconds' | 'outputHardware'
  >
>

const lifetimeMs = 6000

const optimisticFor = (device: Device, action: Action): Override => {
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
    default:
      return {}
  }
}

export type Controls = {
  device: Device
  pending: boolean
  error: string | null
  clearError: () => void
  run: (action: Action) => Promise<boolean>
}

export const useControls = (device: Device): Controls => {
  const [override, setOverride] = useState<{ value: Override; at: number } | null>(null)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // A confirmation poll or the expiry of the window both end the same way: the
  // optimistic value is gone and the device reading shows through again.
  useEffect(() => {
    if (override === null) return
    const remaining = override.at + lifetimeMs - Date.now()
    if (remaining <= 0) {
      setOverride(null)
      return
    }
    const timer = window.setTimeout(() => {
      setOverride(null)
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [override])

  useEffect(() => {
    if (override === null) return
    if (device.updatedAt !== null && device.updatedAt > override.at) setOverride(null)
  }, [device.updatedAt, override])

  const run = useCallback(
    async (action: Action): Promise<boolean> => {
      setError(null)
      setOverride({ value: optimisticFor(device, action), at: Date.now() })
      setPending((count) => count + 1)
      try {
        const result = await sendCommand(device, action)
        if (!result.ok) {
          setError(result.unsupported ? 'unsupported' : result.body || 'failed')
          if (mounted.current) setOverride(null)
          return false
        }
        return true
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        if (mounted.current) {
          setError(message)
          setOverride(null)
        }
        return false
      } finally {
        if (mounted.current) setPending((count) => Math.max(0, count - 1))
      }
    },
    [device],
  )

  const clearError = useCallback(() => setError(null), [])

  const fresh = override !== null && Date.now() - override.at < lifetimeMs
  return {
    device: fresh ? { ...device, ...override.value } : device,
    pending: pending > 0,
    error,
    clearError,
    run,
  }
}
