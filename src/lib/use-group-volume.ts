import { useCallback, useEffect, useRef, useState } from 'react'
import { sendGroupAction } from './api'
import { groupFailure } from './group'
import { overrideLifetimeMs } from './optimistic'
import type { Device } from './types'

// A gesture of the whole group: the slider carries the loudest speaker's level,
// every crank is written while the finger moves, and the rows paint the levels
// the gesture will land on.
//
// Measured: one write per pixel would hammer the master with forty requests for
// one drag. The hub coalesces by speaker already (`server/queue.ts`), and this
// hook adds the other half: one write in flight, a minimum beat between two, the
// last level wins. The release sends the level once more without `live`, which
// also reads the fleet back; the projection then goes when that reading is newer
// than the gesture.
//
// Every request carries the levels the gesture started from. The hub scales each
// speaker from them, so the tenth crank lands exactly where the first one
// promised: scaled from the levels the previous crank wrote instead, ten rounds
// of rounding would drift a speaker a step or two away from what the row showed.

export type GroupDrag = {
  // The level the gesture carries, which is what the group slider shows.
  level: number
  // The anchor's level when the gesture started, or null when nothing could be
  // read: the ratio the rows are painted with.
  from: number | null
  // Every speaker's level when the gesture started, by address.
  bases: Record<string, number>
  at: number
}

export type GroupVolume = {
  drag: GroupDrag | null
  error: string | null
  clearError: () => void
  paint: (from: number | null, bases: Record<string, number>, level: number) => void
  release: (level: number) => Promise<boolean>
  cancel: () => void
}

// Two cranks closer than this are one write: the speaker is a small embedded
// server, and a burst of positions reads as a stutter on the other rooms.
const liveBeatMs = 200

type Slot = {
  queued: number | null
  sent: number | null
  lastAt: number
  stopped: boolean
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => {
    window.setTimeout(resolve, ms)
  })

export const useGroupVolume = (master: Device, onChanged?: () => void): GroupVolume => {
  const [drag, setDrag] = useState<GroupDrag | null>(null)
  const [error, setError] = useState<string | null>(null)
  const slot = useRef<Slot>({ queued: null, sent: null, lastAt: 0, stopped: false })
  // The levels of the gesture in progress: the page sends them on every request,
  // and they belong to the gesture rather than to the current reading.
  const bases = useRef<Record<string, number>>({})
  // A drag is the reader's hand, a reading is the fleet's answer: the projection
  // must survive the first and give way to the second.
  const gesture = useRef(false)
  const sending = useRef<Promise<void> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // A confirmation poll or the expiry of the window both end the same way: the
  // painted levels are gone and the speakers' reading shows through again.
  useEffect(() => {
    if (drag === null || gesture.current) return
    if (master.updatedAt !== null && master.updatedAt > drag.at) setDrag(null)
  }, [master.updatedAt, drag])

  useEffect(() => {
    if (drag === null || gesture.current) return
    const remaining = drag.at + overrideLifetimeMs - Date.now()
    if (remaining <= 0) {
      setDrag(null)
      return
    }
    const timer = window.setTimeout(() => {
      setDrag(null)
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [drag])

  // One loop per burst: it takes the newest crank, waits out the beat, sends,
  // and repeats until nothing newer is queued. A release stops it before its own
  // write, so the last level the speakers see is the one the reader let go of.
  const pump = useCallback((): void => {
    if (sending.current !== null) return
    const current = slot.current
    sending.current = (async () => {
      try {
        while (true) {
          const level = current.queued
          if (level === null || level === current.sent) return
          const wait = current.lastAt + liveBeatMs - Date.now()
          if (wait > 0) await delay(wait)
          if (current.stopped) return
          const latest = current.queued
          if (latest === null || latest === current.sent) return
          current.queued = null
          current.sent = latest
          current.lastAt = Date.now()
          try {
            const answer = await sendGroupAction(
              master,
              { intent: 'volume', level: latest, bases: bases.current },
              { live: true }
            )
            const failure = groupFailure(answer.results)
            if (failure !== null && mounted.current) setError(failure)
          } catch (cause) {
            if (mounted.current) setError(messageOf(cause))
          }
        }
      } finally {
        sending.current = null
      }
    })()
  }, [master])

  const paint = useCallback(
    (from: number | null, start: Record<string, number>, level: number): void => {
      const current = slot.current
      const fresh = !gesture.current
      if (fresh) {
        // A new gesture: the last level of the previous one may be this one, and
        // it still has to reach the speakers.
        current.sent = null
        current.lastAt = 0
        current.queued = null
        bases.current = start
      }
      current.stopped = false
      gesture.current = true
      setDrag(previous => ({
        level,
        from: fresh || previous === null ? from : previous.from,
        bases: fresh || previous === null ? start : previous.bases,
        at: Date.now(),
      }))
      current.queued = level
      pump()
    },
    [pump]
  )

  const cancel = useCallback((): void => {
    gesture.current = false
    slot.current.stopped = true
    slot.current.queued = null
    setDrag(null)
  }, [])

  const release = useCallback(
    async (level: number): Promise<boolean> => {
      const current = slot.current
      gesture.current = false
      current.stopped = true
      current.queued = null
      if (sending.current !== null) await sending.current
      current.stopped = false
      current.sent = level
      setDrag(previous => (previous === null ? null : { ...previous, level, at: Date.now() }))
      setError(null)
      try {
        const answer = await sendGroupAction(master, {
          intent: 'volume',
          level,
          bases: bases.current,
        })
        const failure = groupFailure(answer.results)
        if (failure !== null) {
          if (mounted.current) {
            setError(failure)
            setDrag(null)
          }
          return false
        }
        // The hub read the fleet before answering: the page repaints from that
        // reading, and the projection ends on the first poll newer than it.
        onChanged?.()
        return true
      } catch (cause) {
        if (mounted.current) {
          setError(messageOf(cause))
          setDrag(null)
        }
        return false
      }
    },
    [master, onChanged]
  )

  const clearError = useCallback(() => setError(null), [])

  return { drag, error, clearError, paint, release, cancel }
}
