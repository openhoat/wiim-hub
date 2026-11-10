import { useCallback, useEffect, useRef, useState } from 'react'
import { type Action, sendCommand, sendGroupAction } from './api'
import { groupActionFor, groupFailure } from './group'
import { type Override, optimisticFor, overrideLifetimeMs, withOverride } from './optimistic'
import type { Device } from './types'

export type Controls = {
  device: Device
  pending: boolean
  error: string | null
  clearError: () => void
  run: (action: Action) => Promise<boolean>
}

// `group` changes the path of two gestures, not their meaning: on the card of a
// speaker that drives a group, the volume and the mute belong to what the reader
// hears, which is the whole group. Everything else stays a write on the master,
// where the stream actually runs.
//
// Measured (docs/feature-research.md §5.8.1): the master's own volume moves the
// master alone, so a group volume is a fan-out; the master's mute propagates, so
// a group mute is one write. The server owns both plans, and this hook only says
// which route to take.
export const useControls = (device: Device, options?: { group?: boolean }): Controls => {
  const [override, setOverride] = useState<{ value: Override; at: number } | null>(null)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const grouped = options?.group === true

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
        const group = grouped ? groupActionFor(action) : null
        if (group !== null) {
          const answer = await sendGroupAction(device, group)
          const failure = groupFailure(answer.results)
          if (failure !== null) {
            setError(failure)
            if (mounted.current) setOverride(null)
            return false
          }
          return true
        }
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
    [device, grouped]
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
