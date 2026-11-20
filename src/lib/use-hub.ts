import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchState, runDiscovery } from './api'
import { readSnapshot, writeSnapshot } from './snapshot'
import { readStateStream } from './stream'
import type { HubState } from './types'

const defaultPollMs = 3000
// While the stream carries the fleet, the poll is a backstop: it catches an
// event a cut connection swallowed, without asking every three seconds.
const backstopPollMs = 30_000
// A stream that ends is renewed on a growing delay, and dropped after a few
// tries: the poll is the contract, the stream is the shortcut.
const streamRetryMs = 1000
const streamMaxBreaks = 3

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

// Two ways to read the same fleet. The event stream is the fast one and the
// poll is the one that always works, so the poll never stops: it relaxes to a
// backstop while the stream delivers, keeps its three seconds while it does
// not, and the page survives an install whose ingress buffers the body.
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
  // Whether the stream is delivering right now, which is what the poll reads to
  // choose its cadence.
  const streaming = useRef(false)

  const show = useCallback((next: HubState | null, at: number | null): void => {
    live.current = next
    setState(next)
    setShownAt(at)
  }, [])

  const apply = useCallback(
    (answer: HubState, at: number): void => {
      show(answer, at)
      writeSnapshot(window.localStorage, answer, at)
      setError(null)
      setLoading(false)
    },
    [show]
  )

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
      apply(answer, Date.now())
      // `pollMs` travels in the answer, so the page and the hub never disagree
      // on the cadence; the stream only relaxes it.
      const cadence = Math.max(1000, answer.pollMs || defaultPollMs)
      schedule(streaming.current ? Math.max(backstopPollMs, cadence) : cadence)
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
  }, [apply, schedule, show])

  // The stream reads the fleet as the hub knows it: one frame per tick, and a
  // comment every fifteen seconds that only keeps the connection awake.
  useEffect(() => {
    const control = new AbortController()
    let retry: number | undefined
    let breaks = 0
    const connect = async (): Promise<void> => {
      const outcome = await readStateStream({
        signal: control.signal,
        onState: answer => {
          breaks = 0
          streaming.current = true
          apply(answer, Date.now())
        },
      })
      streaming.current = false
      if (control.signal.aborted) return
      // A route the hub does not serve, or an ingress that buffers the body:
      // neither gets better by asking again, and the poll is already running.
      if (outcome === 'unsupported') return
      breaks += 1
      if (breaks > streamMaxBreaks) return
      // The poll may be parked on its backstop delay: read once now, then let
      // the renewed stream take over.
      schedule(0)
      retry = window.setTimeout(() => void connect(), streamRetryMs * 2 ** (breaks - 1))
    }
    void connect()
    return () => {
      control.abort()
      window.clearTimeout(retry)
      streaming.current = false
    }
  }, [apply, schedule])

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
