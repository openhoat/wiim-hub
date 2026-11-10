import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Speaker,
  Square,
  Timer,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { BrowseSheet } from '@/components/browse-sheet'
import { PlayUrlDialog } from '@/components/play-url-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/cn'
import { formatDuration, positionOf } from '@/lib/format'
import { controlErrorLabel, inputLabel, isExternalInput } from '@/lib/labels'
import { useSettings } from '@/lib/settings'
import type { PlaybackMirror } from '@/lib/types'
import type { Controls } from '@/lib/use-controls'

// The volume ceiling the device reports, with a sane fallback so a missing
// field never produces a slider that cannot reach 100.
const ceilingOf = (maxVolume: number | null): number =>
  maxVolume !== null && maxVolume > 0 ? maxVolume : 100

// Above this level a single stray drag becomes a physical event on a 100 W
// amp: the write is worth one confirmation.
const loudLevel = 85

const sleepOptions = [0, 15, 30, 45, 60, 90]

// Dragging is local state; the write happens once, on release. The server queue
// coalesces too, but the cheapest request is the one never sent.
const VolumeControl = ({ controls }: Readonly<{ controls: Controls }>) => {
  const { t } = useSettings()
  const device = controls.device
  const ceiling = ceilingOf(device.maxVolume)
  const [level, setLevel] = useState(device.volume ?? 0)
  const [confirmLevel, setConfirmLevel] = useState<number | null>(null)

  useEffect(() => {
    setLevel(device.volume ?? 0)
  }, [device.volume])

  const commit = (value: number): void => {
    if (value > loudLevel && (device.volume ?? 0) <= loudLevel) {
      setConfirmLevel(value)
      return
    }
    void controls.run({ action: 'volume', level: value })
  }

  const cancel = (): void => {
    setConfirmLevel(null)
    setLevel(device.volume ?? 0)
  }

  const muted = device.mute

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!device.online}
          aria-label={muted ? t('controls.unmute') : t('controls.mute')}
          aria-pressed={muted}
          onClick={() => void controls.run({ action: 'mute', muted: !muted })}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </Button>
        <input
          type="range"
          min={0}
          max={ceiling}
          step={1}
          value={Math.min(level, ceiling)}
          disabled={!device.online}
          aria-label={t('controls.volume')}
          onChange={event => setLevel(Number(event.currentTarget.value))}
          onPointerUp={() => commit(level)}
          onKeyUp={() => commit(level)}
          onBlur={() => setLevel(device.volume ?? 0)}
          className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-accent disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {device.volume ?? '—'}
        </span>
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
              setConfirmLevel(null)
              void controls.run({ action: 'volume', level: confirmLevel })
            }}
          >
            {t('controls.apply')}
          </Button>
        </div>
      )}
    </div>
  )
}

// The bar doubles as the progress display when the source reports a duration.
// A live stream has no duration to seek in: it keeps a pulse and no input.
const SeekBar = ({ controls, now }: Readonly<{ controls: Controls; now: number }>) => {
  const { t } = useSettings()
  const device = controls.device
  const total = device.totalMs ?? 0
  const live = total <= 0
  const [dragging, setDragging] = useState<number | null>(null)
  const position = dragging ?? positionOf(device, now) ?? device.curposMs ?? 0
  const ratio = live ? 0 : Math.min(1, position / total)

  const release = (): void => {
    if (dragging === null) return
    void controls.run({ action: 'seek', seconds: Math.round(dragging / 1000) })
    setDragging(null)
  }

  return (
    <div>
      {live ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full bg-accent/60',
              device.status === 'play' && 'animate-pulse'
            )}
            style={{ width: device.status === 'play' ? '100%' : '0%' }}
          />
        </div>
      ) : (
        <input
          type="range"
          min={0}
          max={Math.round(total / 1000)}
          step={1}
          value={Math.round(position / 1000)}
          disabled={!device.online}
          aria-label={t('controls.seek')}
          onChange={event => setDragging(Number(event.currentTarget.value) * 1000)}
          onPointerUp={release}
          onKeyUp={release}
          onBlur={() => setDragging(null)}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-accent disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: `linear-gradient(to right, var(--accent) ${Math.round(ratio * 100)}%, var(--muted) ${Math.round(
              ratio * 100
            )}%)`,
          }}
        />
      )}
      <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{formatDuration(position)}</span>
        <span>{live ? t('controls.live') : formatDuration(total)}</span>
      </div>
    </div>
  )
}

export const PlayerControls = ({
  controls,
  now,
}: Readonly<{ controls: Controls; now: number }>) => {
  const { t } = useSettings()
  const device = controls.device
  const online = device.online
  const playing = device.status === 'play'
  const busy = controls.pending
  const sleepSeconds = device.sleepSeconds ?? 0
  const sleepMinutes = Math.ceil(sleepSeconds / 60)
  const external = isExternalInput(device.input)
  const sourceLabel = (input: string): string => inputLabel(t, device.inputLabels, input)
  const outputName =
    device.outputs.find(output => output.hardware === device.outputHardware)?.name ??
    t('controls.outputs')

  return (
    <div className="mt-5 space-y-3">
      {/* An external input has nothing to seek in: the raw position would be the
          residue of the last stream, so the bar is left out entirely. */}
      {!external && <SeekBar controls={controls} now={now} />}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!online || busy}
            aria-label={t('controls.previous')}
            onClick={() => void controls.run({ action: 'prev' })}
          >
            <SkipBack className="size-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            disabled={!online || busy}
            aria-label={playing ? t('controls.pause') : t('controls.play')}
            onClick={() => void controls.run({ action: playing ? 'pause' : 'play' })}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!online || busy}
            aria-label={t('controls.next')}
            onClick={() => void controls.run({ action: 'next' })}
          >
            <SkipForward className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!online || busy}
            aria-label={t('controls.stop')}
            onClick={() => void controls.run({ action: 'stop' })}
          >
            <Square className="size-3.5" />
          </Button>
        </div>
        <VolumeControl controls={controls} />
      </div>

      {device.inputs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">{t('controls.sources')}</span>
          {device.inputs.map(input => (
            <Button
              key={input}
              size="sm"
              variant={device.input === input ? 'default' : 'outline'}
              disabled={!online || busy}
              onClick={() => void controls.run({ action: 'source', input })}
            >
              {sourceLabel(input)}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={!online} className="gap-1.5">
              <Timer className="size-3.5" />
              {sleepSeconds > 0
                ? t('controls.sleepMinutes', { n: sleepMinutes })
                : t('controls.sleep')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>{t('controls.sleep')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sleepSeconds > 0 ? String(sleepMinutes) : '0'}
              onValueChange={value =>
                void controls.run({ action: 'sleep', seconds: Number(value) * 60 })
              }
            >
              {sleepOptions.map(minutes => (
                <DropdownMenuRadioItem key={minutes} value={String(minutes)}>
                  {minutes === 0
                    ? t('controls.sleepOff')
                    : t('controls.sleepMinutes', { n: minutes })}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {device.outputs.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={!online} className="gap-1.5">
                <Speaker className="size-3.5" />
                {outputName}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>{t('controls.outputs')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={device.outputHardware === null ? '' : String(device.outputHardware)}
                onValueChange={value =>
                  void controls.run({ action: 'output', hardware: Number(value) })
                }
              >
                {device.outputs.map(output => (
                  <DropdownMenuRadioItem key={output.hardware} value={String(output.hardware)}>
                    {output.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <PlayUrlDialog controls={controls} />
        <BrowseSheet controls={controls} />
      </div>

      <p
        role="status"
        aria-live="polite"
        className={cn('text-[11px] text-warning', controls.error === null && 'sr-only')}
      >
        {controlErrorLabel(t, controls.error)}
      </p>
    </div>
  )
}

// A member of a running group plays nothing of its own: the stream runs on the
// master, and a transport sent here would drive the member's own silent input,
// not the group. The card therefore shows the progress the master reports, read
// only, and keeps the volume, which is this speaker's own. Driving the group is
// a write on the master, which the hub does not do yet.
const GroupProgress = ({ mirror, now }: Readonly<{ mirror: PlaybackMirror; now: number }>) => {
  const { t } = useSettings()
  const total = mirror.totalMs ?? 0
  const position = positionOf(mirror, now) ?? mirror.curposMs ?? 0
  const ratio = total > 0 ? Math.min(1, position / total) : 0
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full bg-accent/60',
            mirror.status === 'play' && 'animate-pulse'
          )}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{formatDuration(position)}</span>
        <span>{total > 0 ? formatDuration(total) : t('controls.live')}</span>
      </div>
    </div>
  )
}

export const GroupControls = ({
  controls,
  mirror,
  now,
}: Readonly<{ controls: Controls; mirror: PlaybackMirror; now: number }>) => (
  <div className="mt-5 space-y-3">
    <GroupProgress mirror={mirror} now={now} />
    <div className="flex flex-wrap items-center gap-3">
      <VolumeControl controls={controls} />
    </div>
  </div>
)
