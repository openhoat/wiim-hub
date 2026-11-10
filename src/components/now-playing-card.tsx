import { ArrowLeft, ArrowRight, Disc3, Radio, Users } from 'lucide-react'
import { useState } from 'react'
import { DeviceSettingsDialog } from '@/components/device-settings'
import { MemberSheet } from '@/components/member-sheet'
import { PlayerControls, VolumeControl } from '@/components/player-controls'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { artUrl } from '@/lib/api'
import { cardTitle, type FleetCard } from '@/lib/cards'
import { cn } from '@/lib/cn'
import { agoLabel, inputLabel, isExternalInput, statusLabel } from '@/lib/labels'
import { type Translate, useSettings } from '@/lib/settings'
import type { Device, GroupMember, GroupState } from '@/lib/types'
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
// input, then the metadata the player reported, then the source and the group.
const TrackMeta = ({
  title,
  artist,
  album,
  source,
  chip,
}: Readonly<{
  title: string
  artist: string
  album: string
  source: string
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
// card has nothing to move, so the pair is not drawn at all.
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

// A row of the group: the speaker's own name, what it answers, and its volume.
// Its equalizer and its settings live one tap away, in the sheet the row opens,
// because the group card answers "what is playing, and where" and a row of two
// sliders per speaker would compete with that on a phone.
const MemberRow = ({ member, now }: Readonly<{ member: Device; now: number }>) => {
  const { t, resolvedLang } = useSettings()
  const controls = useControls(member)
  const live = controls.device
  const label = t('group.volumeOf', { name: member.name })

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-xs font-medium', !live.online && 'text-muted-foreground')}>
          {member.name}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {live.online
            ? live.model || live.ip
            : `${t('offline')} · ${agoLabel(t, resolvedLang, live.lastSeen, now)}`}
        </p>
      </div>
      <div className="flex min-w-0 basis-full items-center gap-1.5 sm:basis-auto sm:w-56">
        <VolumeControl controls={controls} label={label} />
        <MemberSheet device={member} />
      </div>
    </li>
  )
}

// A member the master names and the fleet does not poll: the vendor app keeps
// it in the saved group, so the row keeps its name and says the address is
// unknown rather than dropping it from the count.
const AbsentRow = ({ member }: Readonly<{ member: GroupMember }>) => {
  const { t } = useSettings()
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <p className="truncate text-xs font-medium text-muted-foreground">{member.name}</p>
      <span className="shrink-0 text-[11px] text-muted-foreground">{t('group.unknown')}</span>
    </li>
  )
}

const MemberList = ({ card, now }: Readonly<{ card: FleetCard; now: number }>) => {
  const { t } = useSettings()
  if (card.members.length === 0 && card.absent.length === 0) return null
  return (
    <div className="mt-4">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {t('group.speakers')}
      </p>
      <ul className="mt-1 divide-y divide-border/60 rounded-xl border border-border/60 px-3">
        {card.members.map(member => (
          <MemberRow key={member.ip} member={member} now={now} />
        ))}
        {card.absent.map(member => (
          <AbsentRow key={member.uuid || member.name} member={member} />
        ))}
      </ul>
    </div>
  )
}

// One card per thing the reader hears: a speaker alone, or a group, which is
// one player driven by its master and rendered by the speakers that follow it
// (src/lib/cards.ts decides which is which, from what the hub confirmed).
export const NowPlayingCard = ({
  card,
  now,
  index = 0,
  count = 1,
  onMove,
}: Readonly<{
  card: FleetCard
  now: number
  index?: number
  count?: number
  onMove?: (delta: -1 | 1) => void
}>) => {
  const { t, resolvedLang } = useSettings()
  const controls = useControls(card.master)
  const live = controls.device
  const [groupOpen, setGroupOpen] = useState(false)
  const title = cardTitle(card)
  // The card is a group when its title is the group's: the reader then needs to
  // know which speaker drives it, and the sub-line says so instead of repeating
  // the model under a name that is not the speaker's.
  const grouped = title !== live.name
  const subtitle = grouped ? `${live.name} · ${live.model}` : live.model || live.ip
  // An external input has no track to show: the card names the source, and the
  // badge keeps the transport state without the "a track is playing" meter.
  const external = isExternalInput(live.input)
  const sourceName = external ? inputLabel(t, live.inputLabels, live.input) : ''
  const headline = sourceName === '' ? live.title : sourceName
  const playing = live.online && live.status === 'play'
  const group = live.group
  // An offline speaker keeps its last known group: showing it would claim a
  // membership nothing just confirmed.
  const showGroup = live.online && (group.role !== 'none' || group.saved)
  const groupPanelId = `group-panel-${card.ip}`
  const chip = showGroup
    ? {
        group,
        open: groupOpen,
        onToggle: () => setGroupOpen(open => !open),
        panelId: groupPanelId,
      }
    : null

  return (
    <Card
      className={cn('p-5 sm:p-6', !live.online && 'opacity-80')}
      data-testid={`playing-${card.ip}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{title}</h2>
          <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {onMove !== undefined && <MoveButtons index={index} count={count} onMove={onMove} />}
          <DeviceSettingsDialog controls={controls} />
          <StatusBadge online={live.online} status={live.status} playing={playing && !external} />
        </div>
      </div>

      <div className="mt-5 flex gap-5">
        <Cover art={artUrl(live)} offline={!live.online} />
        <TrackMeta
          title={headline}
          artist={live.artist}
          album={live.album}
          source={live.source}
          chip={chip}
        />
      </div>

      {showGroup && groupOpen && <GroupPanel group={group} id={groupPanelId} />}

      <PlayerControls controls={controls} now={now} />

      <MemberList card={card} now={now} />

      {!live.online && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {agoLabel(t, resolvedLang, live.lastSeen, now)}
        </p>
      )}
    </Card>
  )
}
