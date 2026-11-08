import { Disc3, Radio, Users, Volume2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { artUrl } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDuration, positionOf } from '@/lib/format'
import { agoLabel, statusLabel } from '@/lib/labels'
import { useSettings } from '@/lib/settings'
import type { Device } from '@/lib/types'

const Equalizer = () => (
  <span className="flex h-3 items-end gap-[2px]" aria-hidden="true">
    {[0, 0.25, 0.5].map((delay) => (
      <span
        key={delay}
        className="eq-bar w-[2px] rounded-full bg-current"
        style={{ height: '100%', animationDelay: `${delay}s` }}
      />
    ))}
  </span>
)

export const NowPlayingCard = ({ device, now }: Readonly<{ device: Device; now: number }>) => {
  const { t } = useSettings()
  const art = artUrl(device)
  const playing = device.online && device.status === 'play'
  const position = positionOf(device, now)
  const ratio =
    position !== null && device.totalMs !== null && device.totalMs > 0
      ? Math.min(1, position / device.totalMs)
      : null
  const quiet = !device.online || position === null

  return (
    <Card className={cn('p-5 sm:p-6', !device.online && 'opacity-80')}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{device.name}</h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {device.model || device.ip}
            {device.group !== '' && device.slaves === 0 && <span className="text-muted-foreground/70"> · {device.group}</span>}
          </p>
        </div>
        <Badge variant={device.online ? (playing ? 'accent' : 'default') : 'warning'}>
          {playing ? (
            <Equalizer />
          ) : (
            <span className={cn('size-1.5 rounded-full', device.online ? 'bg-muted-foreground' : 'bg-warning')} />
          )}
          {device.online ? statusLabel(t, device.status) : t('offline')}
        </Badge>
      </div>

      <div className="mt-5 flex gap-5">
        <div className="relative size-28 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-black/5 sm:size-36 dark:ring-white/5">
          {art !== null ? (
            <img
              src={art}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className={cn('size-full object-cover', !device.online && 'grayscale')}
            />
          ) : (
            <div className="grid size-full place-items-center bg-gradient-to-br from-muted to-muted/30 text-muted-foreground/40">
              <Disc3 className="size-8" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <p className={cn('truncate text-2xl leading-tight font-semibold tracking-tight sm:text-3xl', device.title === '' && 'text-muted-foreground')}>
            {device.title || t('noPlayback')}
          </p>
          <p className="mt-1 truncate text-sm text-muted-foreground">{device.artist || ' '}</p>
          <p className="truncate text-xs text-muted-foreground/70">{device.album || ' '}</p>
          {device.source !== '' && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Radio className="size-3" />
                {device.source}
              </span>
              {device.slaves > 0 && (
                <Badge variant="plain">
                  <Users className="size-3" />
                  {t('groupMembers', { n: device.slaves })}
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full bg-accent', playing && 'transition-[width] duration-1000 ease-linear')}
            style={{ width: `${Math.round((ratio ?? 0) * 100)}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
          <span>{position !== null ? formatDuration(position) : '—'}</span>
          <span className="flex items-center gap-2">
            {device.volume !== null && (
              <span className="inline-flex items-center gap-1">
                <Volume2 className="size-3" />
                {device.volume}
              </span>
            )}
            <span>{quiet ? agoLabel(t, device.lastSeen, now) : formatDuration(device.totalMs ?? 0)}</span>
          </span>
        </div>
      </div>
    </Card>
  )
}
