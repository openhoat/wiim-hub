import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchState, runDiscovery } from './api'
import type { HubState } from './types'

const defaultPollMs = 3000

type Hub = {
  state: HubState | null
  error: string | null
  loading: boolean
  discovering: boolean
  refresh: () => void
  discover: () => Promise<number>
}

// One poll at a time, chained from the previous answer: a slow hub stretches
// the interval instead of stacking requests. The loop stops while the tab is
// hidden, and a return to the foreground reads immediately.
export const useHub = (): Hub => {
  const [state, setState] = useState<HubState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [discovering, setDiscovering] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  // Filled by the polling effect, so the timer never calls a stale closure.
  const next = useRef<() => void>(() => {
    /* replaced once the poller mounts */
  })
  const busy = useRef(false)

  const schedule = useCallback((delay: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => next.current(), delay)
  }, [])

  const tick = useCallback(async () => {
    if (busy.current) return
    if (document.visibilityState === 'hidden') {
      schedule(defaultPollMs)
      return
    }
    busy.current = true
    try {
      const answer = await fetchState()
      setState(answer)
      setError(null)
      schedule(Math.max(1000, answer.pollMs || defaultPollMs))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      schedule(defaultPollMs)
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [schedule])

  useEffect(() => {
    next.current = () => void tick()
  }, [tick])

  useEffect(() => {
    void tick()
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') schedule(0)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [tick, schedule])

  const refresh = useCallback(() => {
    schedule(0)
  }, [schedule])

  const discover = useCallback(async (): Promise<number> => {
    setDiscovering(true)
    try {
      const result = await runDiscovery()
      schedule(0)
      return result.added
    } finally {
      setDiscovering(false)
    }
  }, [schedule])

  return { state, error, loading, discovering, refresh, discover }
}
