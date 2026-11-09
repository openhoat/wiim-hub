import { useCallback, useEffect, useRef, useState } from 'react'
import { type Action, sendCommand } from './api'
import { type Override, optimisticFor, overrideLifetimeMs, withOverride } from './optimistic'
import type { Device } from './types'

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
    const remaining = override.at + overrideLifetimeMs - Date.now()
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
      setPending(count => count + 1)
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
        if (mounted.current) setPending(count => Math.max(0, count - 1))
      }
    },
    [device]
  )

  const clearError = useCallback(() => setError(null), [])

  return {
    device: withOverride(device, override, Date.now()),
    pending: pending > 0,
    error,
    clearError,
    run,
  }
}
