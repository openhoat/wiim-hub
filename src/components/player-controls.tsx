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
import { useState } from 'react'
import { FavoritesSheet } from '@/components/favorites-sheet'
import { PlayUrlDialog } from '@/components/play-url-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { VolumeSheet } from '@/components/volume-sheet'
import { cn } from '@/lib/cn'
import { formatDuration, positionOf } from '@/lib/format'
import { controlErrorLabel, isExternalInput, muteLabel } from '@/lib/labels'
import { useSettings } from '@/lib/settings'
import type { Controls } from '@/lib/use-controls'
import { type VolumeLive, volumeMax } from '@/lib/volume'

const sleepOptions = [0, 15, 30, 45, 60, 90]

// The row keeps the level and opens the pop-in that adjusts it: the inline track
// is a readout a reader can grab with one finger, and the generous control lives
// one gesture deeper, where a thumb fits and the two gestures of the vendor app
// (a drag by crank, a tap either side of the thumb by one) have room.
//
// The number next to the track reads the same level: the value the device reports
// only comes back with the next poll, and a readout that waits for it answers on
// release while the thumb has already moved.
//
// The label names the speaker the control drives when it is drawn outside the
// player: a group card shows one row per speaker, and two controls announced as
// "Volume" tell a screen reader nothing about which one it just opened.
//
// A track can also show a level another gesture paints on it. The group card
// carries the loudest speaker's level, and while the hand moves every row shows
// the level it will land on; the device reading is not what the thumb should
// show then.
//
// A row can finally be silenced: its track stays on screen as the level the
// speaker will come back to, greyed and out of reach, because a group gesture
// writes no volume to a muted member and the mute button is the one control
// left.

export const VolumeControl = ({
  controls,
  label,
  speaker,
  sheetTitle,
  painted = null,
  silent = false,
  live,
}: Readonly<{
  controls: Controls
  label?: string
  speaker?: string
  // The pop-in names what it drives: a card passes its title, so a group's level
  // is not announced as the master's own.
  sheetTitle?: string
  painted?: number | null
  // A speaker under mute: the track is drawn but not reachable.
  silent?: boolean
  live?: VolumeLive
}>) => {
  const { t } = useSettings()
  const device = controls.device
  const [open, setOpen] = useState(false)
  const level = Math.min(painted ?? device.volume ?? 0, volumeMax)
  const percent = `${level}%`
  const readout = device.volume === null && painted === null ? '—' : String(level)
  const muted = device.mute
  // The name of the speaker the button mutes, where the row already names it: a
  // group card draws one mute button per speaker, and two of them announced as
  // "Mute" tell a screen reader nothing about which one it just silenced.
  const muteName = muteLabel(t, muted, speaker)
  const name = label ?? t('controls.volume')

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        {/* Every row keeps its mute button, the master's row included: a
            member's mute silences that member, while the master's reaches the
            whole group (measured). Identical rows are the point; the player
            above the list carries the group's own control. */}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!device.online}
          aria-label={muteName}
          aria-pressed={muted}
          onClick={() => void controls.run({ action: 'mute', muted: !muted })}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              disabled={!device.online || silent}
              aria-label={name}
              title={name}
              className={cn(
                'flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-1 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                silent && 'opacity-50'
              )}
            >
              <span className="relative h-1.5 min-w-0 flex-1 rounded-full bg-muted">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-accent"
                  style={{ width: percent }}
                />
                <span
                  className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-card"
                  style={{ left: percent }}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {readout}
              </span>
            </button>
          </DialogTrigger>
          <VolumeSheet
            controls={controls}
            title={sheetTitle ?? label ?? device.name}
            painted={painted}
            live={live}
          />
        </Dialog>
      </div>
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

// What a speaker does on its own: stop after a timer, pick its output, be handed
// a stream, replay one of its presets. Those belong to one speaker, never to a
// group: a group card leaves them out, and each speaker opens them in its sheet.
export const DeviceToolsRow = ({ controls }: Readonly<{ controls: Controls }>) => {
  const { t } = useSettings()
  const device = controls.device
  const online = device.online
  const sleepSeconds = device.sleepSeconds ?? 0
  const sleepMinutes = Math.ceil(sleepSeconds / 60)
  const outputName =
    device.outputs.find(output => output.hardware === device.outputHardware)?.name ??
    t('controls.outputs')

  return (
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
            <Button
              variant="outline"
              size="sm"
              disabled={!online}
              className="gap-1.5"
              // The visible label is the output's own name, which the source
              // picker of the same sheet can carry too: the name says what the
              // menu sets, so a reader hears the difference.
              aria-label={`${t('controls.outputs')}: ${outputName}`}
            >
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
      <FavoritesSheet controls={controls} />
    </div>
  )
}

export const PlayerControls = ({
  controls,
  now,
  volume,
  tools = true,
}: Readonly<{
  controls: Controls
  now: number
  // The group card names the level its control carries and the gesture every row
  // follows, and the pop-in is titled with the card's own name; a solo player
  // leaves the gesture out and names its speaker.
  volume?: { painted?: number | null; live?: VolumeLive; title?: string }
  // A group card draws the transport and the group volume: the tools of the
  // speaker driving it belong to that speaker, in its own sheet.
  tools?: boolean
}>) => {
  const { t } = useSettings()
  const device = controls.device
  const online = device.online
  const playing = device.status === 'play'
  const busy = controls.pending
  const external = isExternalInput(device.input)

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
        <VolumeControl
          controls={controls}
          sheetTitle={volume?.title}
          painted={volume?.painted ?? null}
          live={volume?.live}
        />
      </div>

      {tools && <DeviceToolsRow controls={controls} />}

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
// not the group. The group card therefore draws no player on a member: its row
// keeps the volume, which is this speaker's own, and the progress belongs to
// the speaker that drives the group.
