import { SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { DeviceSettingsBody } from '@/components/device-settings'
import { VolumeControl } from '@/components/player-controls'
import { EqualizerPanel, QualityChip } from '@/components/sound-card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useSettings } from '@/lib/settings'
import type { Device } from '@/lib/types'
import { useControls } from '@/lib/use-controls'

// A speaker that follows a group has no card of its own any more, so the things
// that used to live on its card need a place: its volume, its equalizer and its
// settings. They open one gesture deep, from the row that names it, because the
// row itself answers what the group card is about (who is playing, and which
// speakers render it).
//
// The sheet is the same content the standalone card carries, not a summary of
// it: a member's equalizer is as real as a master's, and hiding it behind the
// diagnostic view would make it unreachable from where the reader is.
export const MemberSheet = ({ device }: Readonly<{ device: Device }>) => {
  const { t } = useSettings()
  const [open, setOpen] = useState(false)
  const controls = useControls(device)
  const live = controls.device
  const eq = live.eq
  const label = t('group.memberSettings', { name: device.name })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} title={label}>
          <SlidersHorizontal className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('device.close')}>
        <DialogTitle className="text-sm font-medium">{device.name}</DialogTitle>
        <DialogDescription className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">{live.model || live.ip}</span>
          <span className="font-mono">{live.ip}</span>
          <QualityChip device={live} />
        </DialogDescription>

        <div className="mt-4">
          <VolumeControl controls={controls} label={t('group.volumeOf', { name: device.name })} />
        </div>

        <div className="mt-4 border-t border-border/60 pt-4">
          <h3 className="text-sm font-medium">{t('sound.title')}</h3>
          {eq.bands.length > 0 ? (
            <div className="mt-3">
              <EqualizerPanel controls={controls} />
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t(live.online ? 'sound.unavailable' : 'sound.offline')}
            </p>
          )}
        </div>

        <div className="mt-4 border-t border-border/60 pt-1">
          <h3 className="pt-3 text-sm font-medium">{t('device.title')}</h3>
          <DeviceSettingsBody controls={controls} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
