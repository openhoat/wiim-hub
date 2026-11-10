import { LogOut, SlidersHorizontal } from 'lucide-react'
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
import { cn } from '@/lib/cn'
import { controlErrorLabel } from '@/lib/labels'
import { useSettings } from '@/lib/settings'
import type { Device } from '@/lib/types'
import { useControls } from '@/lib/use-controls'
import { useGroupRun } from '@/lib/use-group-run'

// A speaker that follows a group has no card of its own any more, so the things
// that used to live on its card need a place: its volume, its equalizer, its
// settings and the one gesture that takes it out of the group. They open one
// gesture deep, from the row that names it, because the row itself answers what
// the group card is about (who is playing, and which speakers render it).
//
// The sheet is the same content the standalone card carries, not a summary of
// it: a member's equalizer is as real as a master's, and hiding it behind the
// diagnostic view would make it unreachable from where the reader is.
//
// Removing the member is a write on the master, not on the member: the group is
// the master's, and the kick is the measured command that cleans both sides at
// once. It asks first, because the speaker stops rendering the stream.
const RemoveFromGroup = ({
  device,
  master,
  onChanged,
  onDone,
}: Readonly<{
  device: Device
  master: Device
  onChanged?: () => void
  onDone: () => void
}>) => {
  const { t } = useSettings()
  const [confirming, setConfirming] = useState(false)
  const group = useGroupRun(onChanged)

  if (!confirming) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        disabled={!device.online || !master.online}
        onClick={() => setConfirming(true)}
      >
        <LogOut className="size-3.5" />
        {t('group.remove')}
      </Button>
    )
  }
  return (
    <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px]">
      <p className="text-warning">{t('group.removeConfirm', { name: device.name })}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          {t('controls.cancel')}
        </Button>
        <Button
          size="sm"
          disabled={group.pending}
          onClick={() => {
            void group.run(master, { intent: 'kick', member: device.ip }).then(ok => {
              if (!ok) return
              onDone()
            })
          }}
        >
          {t('group.remove')}
        </Button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={cn('mt-1 text-warning', group.error === null && 'sr-only')}
      >
        {controlErrorLabel(t, group.error)}
      </p>
    </div>
  )
}

export const MemberSheet = ({
  device,
  master,
  onChanged,
}: Readonly<{ device: Device; master: Device; onChanged?: () => void }>) => {
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

        <div className="mt-4 flex items-center gap-2">
          {/* Its mute lives beside this slider, in the row of the group card: the
              same control twice would be one too many. */}
          <VolumeControl
            controls={controls}
            label={t('group.volumeOf', { name: device.name })}
            speaker={device.name}
          />
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

        <RemoveFromGroup
          device={device}
          master={master}
          onChanged={onChanged}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
