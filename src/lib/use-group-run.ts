import { useCallback, useEffect, useRef, useState } from 'react'
import { type GroupAction, sendGroupAction } from './api'
import { groupFailure } from './group'
import type { Device } from './types'

// A group gesture sent from somewhere other than the card's volume slider: the
// sheet of a member writes through the master, and the group panel dissolves a
// group or takes one speaker out of it. None of them is a device write, so none
// of them gets an optimistic value: the answer is re-read, and the page renders
// what the speakers report.
export type GroupRun = {
  pending: boolean
  error: string | null
  clearError: () => void
  run: (target: Pick<Device, 'ip'>, action: GroupAction) => Promise<boolean>
}

export const useGroupRun = (onChanged?: () => void): GroupRun => {
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(
    async (target: Pick<Device, 'ip'>, action: GroupAction): Promise<boolean> => {
      setError(null)
      setPending(count => count + 1)
      try {
        const answer = await sendGroupAction(target, action)
        const failure = groupFailure(answer.results)
        if (failure !== null) {
          if (mounted.current) setError(failure)
          return false
        }
        // The hub re-polls before it answers, so one read is enough to show the
        // group the speakers actually form now.
        onChanged?.()
        return true
      } catch (cause) {
        if (mounted.current) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
        return false
      } finally {
        if (mounted.current) setPending(count => Math.max(0, count - 1))
      }
    },
    [onChanged]
  )

  const clearError = useCallback(() => setError(null), [])

  return { pending: pending > 0, error, clearError, run }
}
