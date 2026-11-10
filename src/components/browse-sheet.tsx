import { Library, Play } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { presetArtUrl } from '@/lib/api'
import { controlErrorLabel } from '@/lib/labels'
import { useSettings } from '@/lib/settings'
import type { Controls } from '@/lib/use-controls'

// The slots the player holds, browsed in a sheet rather than printed on the
// card: the card answers "what is playing now", and a list of favourites
// competes with that on a phone. A slot is not always a playlist, since the app
// saves radios and configurations in the same list, so a row prints what the
// firmware reported, cover and service included, and claims nothing more.
//
// A tap sends the slot number and nothing else. On a service slot the player
// resolves the stream itself (measured: `url` answers `unknow`), which is why a
// YouTube Music playlist starts here without the hub holding any account.
export const BrowseSheet = ({ controls }: Readonly<{ controls: Controls }>) => {
  const { t } = useSettings()
  const [open, setOpen] = useState(false)
  const device = controls.device
  const disabled = !device.online || controls.pending

  // The sheet closes once the player accepted the slot: on a phone it covers
  // the card, and the point of the tap is to watch the track start.
  const play = async (slot: number): Promise<void> => {
    const ok = await controls.run({ action: 'preset', slot })
    if (ok) setOpen(false)
  }

  // A speaker that saved nothing has nothing to browse, and a button that opens
  // an empty sheet is a dead end: no trigger at all.
  if (device.presets.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!device.online} className="gap-1.5">
          <Library className="size-3.5" />
          {t('browse.open')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('browse.close')}>
        <DialogTitle className="text-sm font-medium">{t('browse.title')}</DialogTitle>
        <DialogDescription className="mt-1 text-[11px] text-muted-foreground">
          {t('browse.hint')}
        </DialogDescription>

        <ul className="mt-3 space-y-1">
          {device.presets.map(preset => {
            const art = presetArtUrl(device, preset.artwork)
            const slot = t('browse.slot', { n: preset.number })
            const detail = preset.source === '' ? slot : `${preset.source} · ${slot}`
            return (
              <li key={preset.number}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void play(preset.number)}
                  aria-label={`${preset.name}, ${detail}`}
                  className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted text-[11px] tabular-nums text-muted-foreground">
                    {art === null ? (
                      preset.number
                    ) : (
                      <img src={art} alt="" loading="lazy" className="size-full object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{preset.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {detail}
                    </span>
                  </span>
                  <Play className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            )
          })}
        </ul>

        <p
          role="status"
          aria-live="polite"
          className={controls.error === null ? 'sr-only' : 'mt-2 text-[11px] text-warning'}
        >
          {controlErrorLabel(t, controls.error)}
        </p>
      </DialogContent>
    </Dialog>
  )
}
