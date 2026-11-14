import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Disc3,
  Radio,
  Unlink,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { DeviceSettingsDialog } from '@/components/device-settings'
import { MemberSheet } from '@/components/member-sheet'
import { PlayerControls, VolumeControl } from '@/components/player-controls'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { artUrl } from '@/lib/api'
import { cardTitle, drivesGroup, type FleetCard } from '@/lib/cards'
import { cn } from '@/lib/cn'
import { joinTargets } from '@/lib/group'
import { agoLabel, controlErrorLabel, inputLabel, isExternalInput, statusLabel } from '@/lib/labels'
import { type Translate, useSettings } from '@/lib/settings'
import type { Device, GroupMember, GroupState } from '@/lib/types'
import { useControls } from '@/lib/use-controls'
import { useGroupRun } from '@/lib/use-group-run'

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

// The two gestures that end a group, and where each one is allowed: a master
// dissolves what it drives, a member leaves what it follows. Both name the
// speaker in the question, because the button sits on a card that may draw
// three of them.
const GroupTeardown = ({
  role,
  name,
  onRun,
  pending,
}: Readonly<{
  role: GroupState['role']
  name: string
  onRun: (action: 'ungroup' | 'leave') => void
  pending: boolean
}>) => {
  const { t } = useSettings()
  const [confirming, setConfirming] = useState(false)
  if (role !== 'master' && role !== 'member') return null
  const master = role === 'master'
  if (confirming) {
    return (
      <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px]">
        <p className="text-warning">
          {t(master ? 'group.dissolveConfirm' : 'group.leaveConfirm', { name })}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            {t('controls.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              setConfirming(false)
              onRun(master ? 'ungroup' : 'leave')
            }}
          >
            {t(master ? 'group.dissolve' : 'group.leave')}
          </Button>
        </div>
      </div>
    )
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="mt-3"
      disabled={pending}
      onClick={() => setConfirming(true)}
    >
      <Unlink className="size-3.5" />
      {t(master ? 'group.dissolve' : 'group.leave')}
    </Button>
  )
}

const GroupPanel = ({
  group,
  id,
  name,
  onRun,
  pending,
}: Readonly<{
  group: GroupState
  id: string
  name: string
  onRun: (action: 'ungroup' | 'leave') => void
  pending: boolean
}>) => {
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
      <GroupTeardown role={group.role} name={name} onRun={onRun} pending={pending} />
    </div>
  )
}

// A speaker that drives nothing can be drafted into a group, and the choice is
// the master's: the hub only offers speakers that answered a uuid, since a join
// names the master by that identifier. The confirmation names both ends, because
// a mistake here moves the audio of two rooms at once.
const JoinGroup = ({
  device,
  fleet,
  onChanged,
}: Readonly<{ device: Device; fleet: readonly Device[]; onChanged?: () => void }>) => {
  const { t } = useSettings()
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<Device | null>(null)
  const group = useGroupRun(onChanged)
  const targets = joinTargets(fleet, device)
  if (targets.length === 0) return null

  const close = (): void => {
    setChosen(null)
    group.clearError()
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (next) setOpen(true)
        else close()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="mt-4" disabled={!device.online}>
          <Users className="size-3.5" />
          {t('group.join')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('device.close')}>
        <DialogTitle className="text-sm font-medium">
          {t('group.joinTitle', { name: device.name })}
        </DialogTitle>
        <DialogDescription className="mt-1 text-[11px] text-muted-foreground">
          {t('group.joinHint')}
        </DialogDescription>
        <ul className="mt-3 divide-y divide-border/60 rounded-xl border border-border/60 px-3">
          {targets.map(target => (
            <li key={target.ip}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 py-2.5 text-left disabled:opacity-50"
                disabled={group.pending}
                onClick={() => setChosen(target)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{target.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {target.model || target.ip}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
        {chosen !== null && (
          <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px]">
            <p className="text-warning">
              {t('group.joinConfirm', { name: device.name, master: chosen.name })}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setChosen(null)}>
                {t('controls.cancel')}
              </Button>
              <Button
                size="sm"
                disabled={group.pending}
                onClick={() => {
                  void group
                    .run(device, { intent: 'join', master: chosen.ip })
                    .then(ok => ok && close())
                }}
              >
                {t('group.join')}
              </Button>
            </div>
          </div>
        )}
        <p
          role="status"
          aria-live="polite"
          className={cn('mt-2 text-[11px] text-warning', group.error === null && 'sr-only')}
        >
          {controlErrorLabel(t, group.error)}
        </p>
      </DialogContent>
    </Dialog>
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
//
// The volume here is the speaker's own device write, the master's included:
// measured on a real group, `setPlayerCmd:vol` sent to a member moves that member
// alone, and the same command sent to the master moves the master alone (the
// group level is a fan-out, never a value the firmware holds). The master row is
// what the card was missing: the big slider above it fans the group out, so
// without this row the room that drives the group had no level of its own, which
// the vendor app does offer.
//
// Every row is the same row, the master's included: same slider, same mute, same
// sheet. A member's mute silences that member, while the master's reaches the
// whole group (measured); the group's own level and mute stay on the player
// above the list, where the reader also finds the fan-out.
const SpeakerRow = ({
  device,
  master,
  driver = false,
  now,
  onChanged,
}: Readonly<{
  device: Device
  master: Device
  driver?: boolean
  now: number
  onChanged?: () => void
}>) => {
  const { t, resolvedLang } = useSettings()
  const controls = useControls(device)
  const live = controls.device
  const label = t('group.volumeOf', { name: device.name })
  const role = driver ? t('group.driver') : ''
  const state = live.online
    ? [live.model || live.ip, role].filter(part => part !== '').join(' · ')
    : `${t('offline')} · ${agoLabel(t, resolvedLang, live.lastSeen, now)}`

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-xs font-medium', !live.online && 'text-muted-foreground')}>
          {device.name}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">{state}</p>
      </div>
      <div className="flex min-w-0 basis-full items-center gap-1.5 sm:basis-auto sm:w-56">
        <VolumeControl controls={controls} label={label} speaker={device.name} />
        <MemberSheet device={device} master={master} onChanged={onChanged} />
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

// The speakers of a group, the one that drives it included: the reader settles a
// room at a time, and the card's own slider stays the group's level, fanned out
// to every speaker. The master comes first because it is the reference the
// others follow, which is also the order the diagnostic view sorts by.
//
// The list folds like a diagnostic card: a reader who knows the group does not
// need three rows under every card. Expanded is the default, and the fold is a
// preference of the browser, kept on the master's address.
const MemberList = ({
  card,
  now,
  driven,
  collapsed,
  onToggle,
  onChanged,
}: Readonly<{
  card: FleetCard
  now: number
  driven: boolean
  collapsed: boolean
  onToggle?: () => void
  onChanged?: () => void
}>) => {
  const { t } = useSettings()
  if (card.members.length === 0 && card.absent.length === 0) return null
  const panelId = `group-members-${card.ip}`
  const count = (driven ? 1 : 0) + card.members.length + card.absent.length
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {t('group.speakers')}
        </p>
        <span className="text-[11px] tabular-nums text-muted-foreground">({count})</span>
        <span className="flex-1" />
        {onToggle !== undefined && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={collapsed ? t('expand') : t('collapse')}
            title={collapsed ? t('expand') : t('collapse')}
            aria-expanded={!collapsed}
            aria-controls={panelId}
            onClick={onToggle}
          >
            <ChevronDown className={cn('size-4 transition-transform', collapsed && '-rotate-90')} />
          </Button>
        )}
      </div>
      <ul
        id={panelId}
        hidden={collapsed}
        className="mt-1 divide-y divide-border/60 rounded-xl border border-border/60 px-3"
      >
        {driven && (
          <SpeakerRow
            key={card.master.ip}
            device={card.master}
            master={card.master}
            driver
            now={now}
            onChanged={onChanged}
          />
        )}
        {card.members.map(member => (
          <SpeakerRow
            key={member.ip}
            device={member}
            master={card.master}
            now={now}
            onChanged={onChanged}
          />
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
  fleet = [],
  index = 0,
  count = 1,
  membersCollapsed = false,
  onToggleMembers,
  onMove,
  onGroupChanged,
}: Readonly<{
  card: FleetCard
  now: number
  fleet?: readonly Device[]
  index?: number
  count?: number
  membersCollapsed?: boolean
  onToggleMembers?: () => void
  onMove?: (delta: -1 | 1) => void
  onGroupChanged?: () => void
}>) => {
  const { t, resolvedLang } = useSettings()
  const driven = drivesGroup(card)
  const controls = useControls(card.master, { group: driven })
  const live = controls.device
  const groupRun = useGroupRun(onGroupChanged)
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
  // A speaker that follows nothing is the only one that can be drafted into a
  // group, and joining is the one group gesture that is sent to it rather than
  // to a master.
  const canJoin = live.online && group.role === 'none' && joinTargets(fleet, live).length > 0
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
          {/* A group card keeps its header for the group: the settings of the
              speaker that drives it open from its own row, like every other
              room's. A solo card keeps the dialog; it is the only way in. */}
          {!driven && <DeviceSettingsDialog controls={controls} />}
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

      {showGroup && groupOpen && (
        <GroupPanel
          group={group}
          id={groupPanelId}
          name={live.name}
          pending={groupRun.pending}
          onRun={action => void groupRun.run(live, { intent: action })}
        />
      )}

      <PlayerControls controls={controls} now={now} />

      {/* One slider for the whole group is a fan-out, not a group volume the
          device knows: saying so once, where the reader meets it, is cheaper
          than a support question about why the two rooms drift apart. The row of
          the speaker that drives the group, below, is how a room is settled on
          its own. */}
      {driven && <p className="mt-2 text-[11px] text-muted-foreground">{t('group.volumeHint')}</p>}

      <p
        role="status"
        aria-live="polite"
        className={cn('mt-2 text-[11px] text-warning', groupRun.error === null && 'sr-only')}
      >
        {controlErrorLabel(t, groupRun.error)}
      </p>

      <MemberList
        card={card}
        now={now}
        driven={driven}
        collapsed={membersCollapsed}
        onToggle={onToggleMembers}
        onChanged={onGroupChanged}
      />

      {canJoin && <JoinGroup device={live} fleet={fleet} onChanged={onGroupChanged} />}

      {!live.online && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {agoLabel(t, resolvedLang, live.lastSeen, now)}
        </p>
      )}
    </Card>
  )
}
