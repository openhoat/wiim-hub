import type { ChangeEvent, KeyboardEvent, PointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/cn'
import { controlErrorLabel } from '@/lib/labels'
import { useSettings } from '@/lib/settings'
import type { Controls } from '@/lib/use-controls'
import {
  clampVolume,
  crankVolume,
  keyVolume,
  needsConfirmation,
  tapSide,
  type VolumeLive,
  volumeCrank,
  volumeFine,
  volumeMax,
} from '@/lib/volume'

// The pop-in the inline slider opens: the same level, on a track wide enough for
// a thumb, with the two gestures the row cannot carry.
//
// Measured on the vendor app: the dial moves one step when a finger touches a
// side of the thumb, and clicks from mark to mark when dragged. Both live here,
// on one track. A drag lands on the crank, a tap left or right of the thumb
// moves one step, a tap on the thumb moves nothing. The arrows are the same fine
// step from the keyboard, the page keys a crank.
//
// The write stays what it was. A solo speaker takes one command per crank. A
// group paints its fan-out while the finger moves, and the taps of one burst
// keep the levels the first crank started from: ten cranks scaled from the
// previous crank's rounding drift a room a step or two away from what its row
// shows (src/lib/use-group-volume.ts). The burst closes by itself, and the
// release reads the fleet back, which is what the painted rows were waiting for.
const slopPx = 3
const burstMs = 700

export const VolumeSheet = ({
  controls,
  title,
  painted = null,
  live,
}: Readonly<{
  controls: Controls
  title: string
  painted?: number | null
  live?: VolumeLive
}>) => {
  const { t } = useSettings()
  const device = controls.device
  const [pending, setPending] = useState<number | null>(null)
  const [confirmLevel, setConfirmLevel] = useState<number | null>(null)
  const track = useRef<HTMLInputElement | null>(null)
  const start = useRef<{ x: number; moved: boolean } | null>(null)
  const beat = useRef<number | null>(null)
  const queued = useRef<number | null>(null)
  // The card rebuilds its gesture object on every render: the unmount release
  // has to read the latest one rather than the one it was mounted with.
  const liveRef = useRef(live)
  // The level a gesture starts from, which is what the confirmation threshold
  // compares with: the painted level when a group carries the gesture, the
  // device's own otherwise.
  const base = painted ?? device.volume ?? 0
  const level = Math.min(pending ?? painted ?? device.volume ?? 0, volumeMax)
  const percent = `${level}%`
  const readout = device.volume === null && painted === null ? '—' : String(level)

  useEffect(() => {
    liveRef.current = live
  })

  // A sheet closed before its burst ends still has to end the gesture: the rows
  // are painted on levels nothing confirmed, and only the release reads the
  // fleet back.
  useEffect(() => {
    const stop = (): void => {
      if (beat.current !== null) window.clearTimeout(beat.current)
      beat.current = null
      const last = queued.current
      queued.current = null
      if (last !== null) liveRef.current?.onRelease(last)
    }
    return stop
  }, [])

  const settle = (value: number): void => {
    queued.current = value
    if (beat.current !== null) window.clearTimeout(beat.current)
    beat.current = window.setTimeout(() => {
      beat.current = null
      const last = queued.current
      queued.current = null
      if (last !== null) liveRef.current?.onRelease(last)
    }, burstMs)
  }

  // One exit for a level that is settled: the solo write, or the end of a group
  // gesture. An immediate release is a drag letting go, which reads the fleet
  // back at once; a tap only ends its burst later.
  const write = (value: number, immediate: boolean): void => {
    setPending(null)
    setConfirmLevel(null)
    if (live === undefined) {
      void controls.run({ action: 'volume', level: value })
      return
    }
    if (immediate) {
      queued.current = null
      if (beat.current !== null) {
        window.clearTimeout(beat.current)
        beat.current = null
      }
      live.onRelease(value)
      return
    }
    live.onChange(value)
    settle(value)
  }

  const nudge = (value: number): void => {
    const next = clampVolume(value)
    if (next === level) return
    if (needsConfirmation(base, next)) {
      // Nothing is written beyond the threshold: the number shows the level the
      // reader asked for, and the band below is the only control left.
      setPending(next)
      setConfirmLevel(next)
      live?.onCancel()
      return
    }
    write(next, false)
  }

  const commit = (): void => {
    if (pending === null) return
    if (needsConfirmation(base, pending)) {
      setConfirmLevel(pending)
      live?.onCancel()
      return
    }
    write(pending, true)
  }

  const ratioAt = (clientX: number): number => {
    const rect = track.current?.getBoundingClientRect()
    if (rect === undefined || rect.width === 0) return 0
    const ratio = (clientX - rect.left) / rect.width
    return Math.min(1, Math.max(0, ratio))
  }

  const drag = (value: number): void => {
    if (value === pending) return
    setPending(value)
    // Above the threshold the write waits for the confirmation, so the thumb
    // moves alone: no level beyond it reaches the speakers on its own.
    if (live === undefined || needsConfirmation(base, value)) return
    live.onChange(value)
  }

  const onPointerDown = (event: PointerEvent<HTMLInputElement>): void => {
    if (!device.online) return
    // The browser's own range jumps the thumb to the contact point; the gesture
    // has two meanings here, so the contact only arms it and the release decides
    // which one it was.
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    start.current = { x: event.clientX, moved: false }
  }

  const onPointerMove = (event: PointerEvent<HTMLInputElement>): void => {
    const gesture = start.current
    if (gesture === null) return
    if (!gesture.moved && Math.abs(event.clientX - gesture.x) < slopPx) return
    gesture.moved = true
    drag(crankVolume(ratioAt(event.clientX) * volumeMax))
  }

  const onPointerUp = (event: PointerEvent<HTMLInputElement>): void => {
    const gesture = start.current
    start.current = null
    if (gesture === null) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (gesture.moved) {
      commit()
      return
    }
    const side = tapSide(level, ratioAt(event.clientX))
    if (side !== 0) nudge(level + side)
  }

  const onPointerCancel = (): void => {
    start.current = null
    setPending(null)
    live?.onCancel()
  }

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    nudge(Number(event.currentTarget.value))
  }

  // The browser's own range maps PageUp to a tenth of the scale and Home/End to
  // the bounds; the pop-in keeps the two steps it promised, at every key.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const next = keyVolume(level, event.key)
    if (next === null) return
    event.preventDefault()
    nudge(next)
  }

  const cancel = (): void => {
    setConfirmLevel(null)
    setPending(null)
    live?.onCancel()
  }

  return (
    <DialogContent closeLabel={t('device.close')}>
      <DialogTitle className="text-sm font-medium">{title}</DialogTitle>
      <DialogDescription className="mt-1 text-[11px] text-muted-foreground">
        {t('controls.volumeHint', { crank: volumeCrank, fine: volumeFine })}
      </DialogDescription>

      <p data-testid="volume-level" className="mt-3 text-3xl font-semibold tabular-nums">
        {readout}
      </p>

      <div className="relative mt-2 h-14 w-full rounded-xl has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full bg-accent', !device.online && 'opacity-50')}
            style={{ width: percent }}
          />
        </div>
        <div
          className={cn(
            'pointer-events-none absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-md ring-2 ring-card',
            !device.online && 'opacity-50'
          )}
          style={{ left: percent }}
        />
        <input
          ref={track}
          type="range"
          min={0}
          max={volumeMax}
          step={volumeFine}
          value={level}
          disabled={!device.online}
          aria-label={title}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          // Transparent over the painted track: the native control keeps the
          // keyboard, the focus order and the announced range, while the two
          // pointer gestures are read here.
          className="absolute inset-0 size-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed"
        />
      </div>

      {confirmLevel !== null && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-[11px]">
          <span className="text-warning">{t('controls.confirmVolume', { n: confirmLevel })}</span>
          <Button size="sm" variant="ghost" onClick={cancel}>
            {t('controls.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              write(confirmLevel, true)
            }}
          >
            {t('controls.apply')}
          </Button>
        </div>
      )}

      <p
        role="status"
        aria-live="polite"
        className={cn('mt-2 text-[11px] text-warning', controls.error === null && 'sr-only')}
      >
        {controlErrorLabel(t, controls.error)}
      </p>
    </DialogContent>
  )
}
