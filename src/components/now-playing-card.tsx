import { Disc3, Radio, Users } from 'lucide-react'
import { useState } from 'react'
import { DeviceSettingsDialog } from '@/components/device-settings'
import { PlayerControls } from '@/components/player-controls'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { artUrl } from '@/lib/api'
import { cn } from '@/lib/cn'
import { agoLabel, inputLabel, isExternalInput, statusLabel } from '@/lib/labels'
import { useSettings } from '@/lib/settings'
import type { Device, GroupState } from '@/lib/types'
import { useControls } from '@/lib/use-controls'

const Equalizer = () => (
  <span className="flex h-3 items-end gap-[2px]" aria-hidden="true">
    {[0, 0.25, 0.5].map(delay => (
      <span
        key={delay}
        className="eq-bar w-[2px] rounded-full bg-current"
        style={{ height: '100%', animationDelay: `${delay}s` }}
      />
    ))}
  </span>
)

// Multiroom is read only here: the chip only exists once the device reports a
// group, and the panel repeats what it said, including "saved but not running"
// instead of turning a remembered member into an offline one.
const GroupChip = ({
  group,
  open,
  onToggle,
  panelId,
}: Readonly<{ group: GroupState; open: boolean; onToggle: () => void; panelId: string }>) => {
  const { t } = useSettings()
  const count = group.members.length
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
    >
      <Users className="size-3" />
      {group.name || t('group.label')}
      {count > 0 && <span className="tabular-nums">· {t('group.members', { n: count })}</span>}
    </button>
  )
}

const GroupPanel = ({ group, id }: Readonly<{ group: GroupState; id: string }>) => {
  const { t } = useSettings()
  const note =
    group.role === 'master'
      ? t('group.role.master')
      : group.role === 'member'
        ? t('group.role.member')
        : t('group.saved')
  return (
    <div id={id} className="mt-4 rounded-xl border border-border/60 bg-muted/20 p-3">
      <p className="text-[11px] text-muted-foreground">{note}</p>
      {group.members.length > 0 && (
        <ul className="mt-2 space-y-1">
          {group.members.map(member => (
            <li
              key={member.uuid || member.name}
              className="flex items-center justify-between gap-3 text-xs"
            >
              <span className="truncate">{member.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {member.ip || t('group.unknown')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const NowPlayingCard = ({ device, now }: Readonly<{ device: Device; now: number }>) => {
  const { t } = useSettings()
  const controls = useControls(device)
  const live = controls.device
  const art = artUrl(live)
  const playing = live.online && live.status === 'play'
  // An external input has no track to show: the card names the source, and the
  // badge keeps the transport state without the "a track is playing" meter.
  const external = isExternalInput(live.input)
  const sourceName = external ? inputLabel(t, live.inputLabels, live.input) : ''
  const headline = sourceName !== '' ? sourceName : live.title
  const [groupOpen, setGroupOpen] = useState(false)
  const group = live.group
  // An offline speaker keeps its last known group: showing it would claim a
  // membership nothing just confirmed.
  const showGroup = live.online && (group.role !== 'none' || group.saved)
  const groupPanelId = `group-panel-${device.ip}`

  return (
    <Card className={cn('p-5 sm:p-6', !device.online && 'opacity-80')}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{device.name}</h2>
          <p className="truncate text-[11px] text-muted-foreground">{device.model || device.ip}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <DeviceSettingsDialog controls={controls} />
          <Badge
            variant={device.online ? (playing && !external ? 'accent' : 'default') : 'warning'}
          >
            {playing && !external ? (
              <Equalizer />
            ) : (
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  device.online ? 'bg-muted-foreground' : 'bg-warning'
                )}
              />
            )}
            {device.online ? statusLabel(t, live.status) : t('offline')}
          </Badge>
        </div>
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
          <p
            className={cn(
              'truncate text-2xl leading-tight font-semibold tracking-tight sm:text-3xl',
              headline === '' && 'text-muted-foreground'
            )}
          >
            {headline !== '' ? headline : t('noPlayback')}
          </p>
          <p className="mt-1 truncate text-sm text-muted-foreground">{device.artist || ' '}</p>
          <p className="truncate text-xs text-muted-foreground/70">{device.album || ' '}</p>
          {(device.source !== '' || showGroup) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {device.source !== '' && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Radio className="size-3" />
                  {device.source}
                </span>
              )}
              {showGroup && (
                <GroupChip
                  group={group}
                  open={groupOpen}
                  onToggle={() => setGroupOpen(open => !open)}
                  panelId={groupPanelId}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {showGroup && groupOpen && <GroupPanel group={group} id={groupPanelId} />}

      <PlayerControls controls={controls} now={now} />

      {!device.online && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {agoLabel(t, device.lastSeen, now)}
        </p>
      )}
    </Card>
  )
}
