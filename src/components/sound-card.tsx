import { AudioLines, ChevronRight, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/cn'
import { controlErrorLabel } from '@/lib/labels'
import { useSettings } from '@/lib/settings'
import type { Device, EqBand } from '@/lib/types'
import { type Controls, useControls } from '@/lib/use-controls'

// The device names its bands `band31hz`..`band16khz`: the number and the unit
// are the only readable part, and the scale is a decade apart, so format it
// rather than translating ten labels.
const bandLabel = (name: string): string => {
  const match = /^band(\d+)(hz|khz)$/.exec(name)
  if (match === null) return name
  return `${match[1]} ${match[2] === 'khz' ? 'kHz' : 'Hz'}`
}

// Ten labels do not fit a phone: the column under a bar carries the number
// alone, and the selected band spells the unit above the slider.
const bandShort = (name: string): string => {
  const match = /^band(\d+)(hz|khz)$/.exec(name)
  if (match === null) return name
  return match[2] === 'khz' ? `${match[1]}k` : match[1]
}

const gainLabel = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`

const rangeLabel = (value: number | null, unit: string): string | null =>
  value === null || value <= 0 ? null : `${value} ${unit}`

// One bar of the curve, drawn from the middle line: the device accepts
// -12..+12 dB, so a full bar half-height is the maximum.
const BandBar = ({
  band,
  selected,
  disabled,
  onSelect,
}: Readonly<{ band: EqBand; selected: boolean; disabled: boolean; onSelect: () => void }>) => {
  const ratio = Math.min(1, Math.abs(band.value) / 12)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-label={`${bandLabel(band.name)} ${gainLabel(band.value)}`}
      aria-pressed={selected}
      className={cn(
        'relative h-20 w-full overflow-hidden rounded-md transition-colors',
        selected ? 'bg-accent/15 ring-1 ring-accent/50' : 'bg-muted/40 hover:bg-muted/70',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <span
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border"
        aria-hidden="true"
      />
      <span
        className={cn(
          'absolute inset-x-1 rounded-sm',
          band.value >= 0 ? 'bottom-1/2 bg-accent' : 'top-1/2 bg-accent/60'
        )}
        style={{ height: `${Math.max(ratio * 50, 1.5)}%` }}
      />
    </button>
  )
}

// The curve is read live and edited one band at a time: a row of ten vertical
// sliders is unusable on a phone, so a band is picked on the curve and the
// slider under it drives the value.
export const EqualizerPanel = ({ controls }: Readonly<{ controls: Controls }>) => {
  const { t } = useSettings()
  const device = controls.device
  const eq = device.eq
  const online = device.online
  const [band, setBand] = useState<string | null>(null)
  const [draft, setDraft] = useState<number | null>(null)

  // Keep a band selected as long as the curve exists: the slider is the main
  // affordance, and hiding it behind a first click makes the panel look inert.
  useEffect(() => {
    if (eq.bands.length === 0) {
      setBand(null)
      return
    }
    setBand(current =>
      current !== null && eq.bands.some(entry => entry.name === current)
        ? current
        : (eq.bands[4]?.name ?? eq.bands[0].name)
    )
  }, [eq.bands])

  const selected = eq.bands.find(entry => entry.name === band) ?? null
  const value = draft ?? selected?.value ?? 0

  const commit = (): void => {
    if (draft === null || selected === null) return
    void controls.run({ action: 'eqBand', band: selected.name, value: draft })
    setDraft(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{t('sound.equalizer')}</span>
          <Button
            size="sm"
            variant={eq.enabled ? 'default' : 'outline'}
            disabled={!online || controls.pending}
            aria-pressed={eq.enabled}
            onClick={() => void controls.run({ action: 'eq', enabled: !eq.enabled })}
          >
            {eq.enabled ? t('sound.on') : t('sound.off')}
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={!online || eq.presets.length === 0}
              className="max-w-48 gap-1.5"
            >
              <SlidersHorizontal className="size-3.5 shrink-0" />
              <span className="truncate">{eq.name === '' ? t('sound.custom') : eq.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
            <DropdownMenuLabel>{t('sound.presets')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={eq.name}
              onValueChange={name => void controls.run({ action: 'eqPreset', name })}
            >
              {eq.presets.map(name => (
                <DropdownMenuRadioItem key={name} value={name}>
                  {name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid grid-cols-10 gap-1">
        {eq.bands.map(entry => (
          <div key={entry.name} className="flex min-w-0 flex-col items-center gap-1">
            <BandBar
              band={entry}
              selected={entry.name === band}
              disabled={!online || controls.pending}
              onSelect={() => {
                setBand(entry.name)
                setDraft(null)
              }}
            />
            <span className="text-[10px] tabular-nums text-muted-foreground/80">
              {bandShort(entry.name)}
            </span>
          </div>
        ))}
      </div>

      {selected !== null && (
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {bandLabel(selected.name)}
          </span>
          <input
            type="range"
            min={-12}
            max={12}
            step={0.5}
            value={value}
            disabled={!online || controls.pending}
            aria-label={`${bandLabel(selected.name)} ${t('sound.gain')}`}
            onChange={event => setDraft(Number(event.currentTarget.value))}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={() => setDraft(null)}
            className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-accent disabled:cursor-not-allowed disabled:opacity-50"
          />
          <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {gainLabel(value)}
          </span>
        </div>
      )}

      {!eq.enabled && eq.bands.length > 0 && (
        <p className="text-[11px] text-muted-foreground">{t('sound.offHint')}</p>
      )}

      {eq.roomFit && <p className="text-[11px] text-muted-foreground">{t('sound.roomFit')}</p>}
    </div>
  )
}

// The stream numbers describe the codec in flight: they come with every
// metadata read and disappear when playback stops, so they are shown next to
// the equalizer rather than in a panel of their own.
export const QualityChip = ({ device }: Readonly<{ device: Device }>) => {
  const { t } = useSettings()
  const parts = [
    rangeLabel(
      device.quality.sampleRate === null ? null : Math.round(device.quality.sampleRate / 100) / 10,
      'kHz'
    ),
    rangeLabel(device.quality.bitDepth, 'bit'),
    rangeLabel(device.quality.bitRate, 'kb/s'),
  ].filter((part): part is string => part !== null)

  if (parts.length === 0) return null
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground"
      title={t('sound.quality')}
    >
      <AudioLines className="size-3" />
      {parts.join(' · ')}
    </span>
  )
}

export const SoundCard = ({ device }: Readonly<{ device: Device }>) => {
  const { t } = useSettings()
  // The curve is a wall of ten bars nobody reads at a glance: the card opens on
  // a gesture, and the poll keeps the data fresh so the gesture costs no wait.
  const [open, setOpen] = useState(false)
  const controls = useControls(device)
  const eq = controls.device.eq
  const available = eq.bands.length > 0
  const panelId = `sound-panel-${device.ip}`

  return (
    <Card className={cn('p-5 sm:p-6', !device.online && 'opacity-80')}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${t('sound.title')}, ${open ? t('sound.hide') : t('sound.show')}`}
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90'
            )}
          />
          <h2 className="text-sm font-medium">{t('sound.title')}</h2>
        </span>
        <QualityChip device={controls.device} />
      </button>

      {open && (
        <div id={panelId} className="mt-4">
          {available ? (
            <EqualizerPanel controls={controls} />
          ) : (
            // A silent speaker and a speaker without an equalizer look the same
            // on the wire; the card must not blame the model for a network miss.
            <p className="text-[11px] text-muted-foreground">
              {t(device.online ? 'sound.unavailable' : 'sound.offline')}
            </p>
          )}
        </div>
      )}

      <p
        role="status"
        aria-live="polite"
        className={cn('mt-2 text-[11px] text-warning', controls.error === null && 'sr-only')}
      >
        {controlErrorLabel(t, controls.error)}
      </p>
    </Card>
  )
}
