import { cn } from '@/lib/cn'
import { eventKindLabel, eventText } from '@/lib/labels'
import { useSettings } from '@/lib/settings'
import type { DeviceEvent } from '@/lib/types'

const colorOf = (kind: DeviceEvent['kind']): string =>
  kind === 'online'
    ? 'bg-accent'
    : kind === 'offline'
      ? 'bg-warning'
      : kind === 'track'
        ? 'bg-foreground/40'
        : 'bg-muted-foreground/40'

const clockOf = (at: number): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(at)

export const EventTimeline = ({ events }: Readonly<{ events: DeviceEvent[] }>) => {
  const { t } = useSettings()
  if (events.length === 0) {
    return <p className="py-3 text-xs text-muted-foreground">{t('noEvents')}</p>
  }
  return (
    <ol className="divide-y divide-border/60">
      {events.slice(0, 8).map(event => (
        <li
          key={`${event.t}-${event.kind}-${event.to}`}
          className="flex items-baseline gap-3 py-1.5 text-xs"
        >
          <span className="w-16 shrink-0 tabular-nums text-muted-foreground/70">
            {clockOf(event.t)}
          </span>
          <span
            className={cn('size-1.5 shrink-0 translate-y-[-1px] rounded-full', colorOf(event.kind))}
          />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-muted-foreground">{eventKindLabel(t, event.kind)}</span>
            {eventText(t, event) !== '' && <span className="ml-1.5">{eventText(t, event)}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}
