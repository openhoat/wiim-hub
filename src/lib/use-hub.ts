import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchState, runDiscovery } from './api'
import { readSnapshot, writeSnapshot } from './snapshot'
import type { HubState } from './types'

const defaultPollMs = 3000

type Hub = {
  state: HubState | null
  error: string | null
  loading: boolean
  discovering: boolean
  // When the state on screen was received. With an error, it is what the banner
  // dates; without one it is simply the last answer.
  shownAt: number | null
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
  const [shownAt, setShownAt] = useState<number | null>(null)
  const timer = useRef<number | undefined>(undefined)
  // Filled by the polling effect, so the timer never calls a stale closure.
  const next = useRef<() => void>(() => {
    /* replaced once the poller mounts */
  })
  const busy = useRef(false)
  // The state on screen, readable from the poll without waiting for a render:
  // the first failure is what decides whether the snapshot is adopted.
  const live = useRef<HubState | null>(null)

  const show = useCallback((next: HubState | null, at: number | null): void => {
    live.current = next
    setState(next)
    setShownAt(at)
  }, [])

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
      const at = Date.now()
      show(answer, at)
      writeSnapshot(window.localStorage, answer, at)
      setError(null)
      schedule(Math.max(1000, answer.pollMs || defaultPollMs))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      // Nothing live yet: the page may have been reopened while the hub was
      // already unreachable, so the last state received is better than an empty
      // page, as long as it is dated.
      if (live.current === null) {
        const snapshot = readSnapshot(window.localStorage)
        if (snapshot !== null) show(snapshot.state, snapshot.at)
      }
      schedule(defaultPollMs)
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [schedule, show])

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

  return { state, error, loading, discovering, shownAt, refresh, discover }
}
