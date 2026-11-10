import { ArrowLeft, ArrowRight, Disc3, Radio, Users } from 'lucide-react'
import { useState } from 'react'
import { DeviceSettingsDialog } from '@/components/device-settings'
import { GroupControls, PlayerControls } from '@/components/player-controls'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { artUrl } from '@/lib/api'
import { cn } from '@/lib/cn'
import { agoLabel, inputLabel, isExternalInput, statusLabel } from '@/lib/labels'
import { type Translate, useSettings } from '@/lib/settings'
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

// The role decides the sentence, and "saved" is the fallback: a group that
// exists in the vendor app but is not running.
const roleNoteOf = (role: GroupState['role'], t: Translate): string => {
  if (role === 'master') return t('group.role.master')
  return role === 'member' ? t('group.role.member') : t('group.saved')
}

const GroupPanel = ({ group, id }: Readonly<{ group: GroupState; id: string }>) => {
  const { t } = useSettings()
  const note = roleNoteOf(group.role, t)
  return (
    <div id={id} className="mt-4 rounded-xl border border-border/60 bg-muted/20 p-3">
      <p className="text-[11px] text-muted-foreground">{note}</p>
      {group.parent !== null && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t('group.follows', { name: group.parent.name })}
        </p>
      )}
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

// Offline wins over playing: a speaker that stopped answering keeps its last
// transport state, and the badge must not animate for it.
const badgeVariant = (online: boolean, playing: boolean): 'accent' | 'default' | 'warning' => {
  if (!online) return 'warning'
  return playing ? 'accent' : 'default'
}

const StatusBadge = ({
  online,
  status,
  playing,
}: Readonly<{ online: boolean; status: string; playing: boolean }>) => {
  const { t } = useSettings()
  return (
    <Badge variant={badgeVariant(online, playing)}>
      {playing ? (
        <Equalizer />
      ) : (
        <span
          className={cn('size-1.5 rounded-full', online ? 'bg-muted-foreground' : 'bg-warning')}
        />
      )}
      {online ? statusLabel(t, status) : t('offline')}
    </Badge>
  )
}

const Cover = ({ art, offline }: Readonly<{ art: string | null; offline: boolean }>) => (
  <div className="relative size-28 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-black/5 sm:size-36 dark:ring-white/5">
    {art === null ? (
      <div className="grid size-full place-items-center bg-gradient-to-br from-muted to-muted/30 text-muted-foreground/40">
        <Disc3 className="size-8" />
      </div>
    ) : (
      <img
        src={art}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className={cn('size-full object-cover', offline && 'grayscale')}
      />
    )}
  </div>
)

// The track block: a headline that falls back to the source name on an external
// input, then the metadata the player reported, then the source, the note that
// says where a mirrored playback comes from, and the group.
const TrackMeta = ({
  title,
  artist,
  album,
  source,
  note,
  chip,
}: Readonly<{
  title: string
  artist: string
  album: string
  source: string
  note: string | null
  chip: { group: GroupState; open: boolean; onToggle: () => void; panelId: string } | null
}>) => {
  const { t } = useSettings()
  const showSource = source !== ''
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center">
      <p
        className={cn(
          'truncate text-2xl leading-tight font-semibold tracking-tight sm:text-3xl',
          title === '' && 'text-muted-foreground'
        )}
      >
        {title === '' ? t('noPlayback') : title}
      </p>
      <p className="mt-1 truncate text-sm text-muted-foreground">{artist || ' '}</p>
      <p className="truncate text-xs text-muted-foreground/70">{album || ' '}</p>
      {note !== null && <p className="mt-1 truncate text-[11px] text-muted-foreground">{note}</p>}
      {(showSource || chip !== null) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {showSource && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Radio className="size-3" />
              {source}
            </span>
          )}
          {chip !== null && (
            <GroupChip
              group={chip.group}
              open={chip.open}
              onToggle={chip.onToggle}
              panelId={chip.panelId}
            />
          )}
        </div>
      )}
    </div>
  )
}

// The order of the cards belongs to the reader, not to the hub: the arrows move
// one card against its neighbour, on the order stored in the page. A single
// speaker has nothing to move, so the pair is not drawn at all.
const MoveButtons = ({
  index,
  count,
  onMove,
}: Readonly<{ index: number; count: number; onMove: (delta: -1 | 1) => void }>) => {
  const { t } = useSettings()
  if (count < 2) return null
  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('moveEarlier')}
        title={t('moveEarlier')}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowLeft className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('moveLater')}
        title={t('moveLater')}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowRight className="size-4" />
      </Button>
    </div>
  )
}

export const NowPlayingCard = ({
  device,
  now,
  index = 0,
  count = 1,
  onMove,
}: Readonly<{
  device: Device
  now: number
  index?: number
  count?: number
  onMove?: (delta: -1 | 1) => void
}>) => {
  const { t, resolvedLang } = useSettings()
  const controls = useControls(device)
  const live = controls.device
  const [groupOpen, setGroupOpen] = useState(false)
  // A member of a running group plays nothing of its own: what is audible comes
  // from the speaker that drives the group, and the fleet pass copied it here.
  // An offline speaker shows no mirror, since nothing just confirmed the group.
  const mirror = live.online ? live.mirror : null
  // An external input has no track to show: the card names the source, and the
  // badge keeps the transport state without the "a track is playing" meter.
  const external = isExternalInput(live.input)
  const sourceName = external ? inputLabel(t, live.inputLabels, live.input) : ''
  const headline = mirror !== null ? mirror.title : sourceName === '' ? live.title : sourceName
  const playing = live.online && (mirror?.status ?? live.status) === 'play'
  const group = live.group
  // An offline speaker keeps its last known group: showing it would claim a
  // membership nothing just confirmed.
  const showGroup = live.online && (group.role !== 'none' || group.saved)
  const groupPanelId = `group-panel-${device.ip}`
  // The cover of a mirrored playback belongs to the master: the art route checks
  // the uri against the answer of the speaker it is asked for.
  const coverArt =
    mirror === null ? artUrl(live) : artUrl({ ip: mirror.from.ip, albumArt: mirror.albumArt })

  return (
    <Card
      className={cn('p-5 sm:p-6', !device.online && 'opacity-80')}
      data-testid={`playing-${device.ip}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{device.name}</h2>
          <p className="truncate text-[11px] text-muted-foreground">{device.model || device.ip}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {onMove !== undefined && <MoveButtons index={index} count={count} onMove={onMove} />}
          <DeviceSettingsDialog controls={controls} />
          <StatusBadge
            online={device.online}
            status={mirror?.status ?? live.status}
            playing={playing && !external}
          />
        </div>
      </div>

      <div className="mt-5 flex gap-5">
        <Cover art={coverArt} offline={!device.online} />
        <TrackMeta
          title={headline}
          artist={mirror?.artist ?? live.artist}
          album={mirror?.album ?? live.album}
          source={mirror?.source ?? device.source}
          note={mirror === null ? null : t('group.reflected', { name: mirror.from.name })}
          chip={
            showGroup
              ? {
                  group,
                  open: groupOpen,
                  onToggle: () => setGroupOpen(open => !open),
                  panelId: groupPanelId,
                }
              : null
          }
        />
      </div>

      {showGroup && groupOpen && <GroupPanel group={group} id={groupPanelId} />}

      {mirror === null ? (
        <PlayerControls controls={controls} now={now} />
      ) : (
        <GroupControls controls={controls} mirror={mirror} now={now} />
      )}

      {!device.online && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {agoLabel(t, resolvedLang, device.lastSeen, now)}
        </p>
      )}
    </Card>
  )
}
