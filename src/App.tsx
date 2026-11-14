import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { DiagnosticCard } from '@/components/diagnostic-card'
import { EmptyState } from '@/components/empty-state'
import { Header } from '@/components/header'
import { HubBanner } from '@/components/hub-banner'
import { NowPlayingCard } from '@/components/now-playing-card'
import { SoundCard } from '@/components/sound-card'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/toaster'
import { UpdateBanner } from '@/components/update-banner'
import { drivesGroup, fleetCards } from '@/lib/cards'
import { cn } from '@/lib/cn'
import { inputLabel, isExternalInput } from '@/lib/labels'
import { sortDevices } from '@/lib/layout'
import { SettingsProvider, useSettings } from '@/lib/settings'
import type { Device, View } from '@/lib/types'
import { useHub } from '@/lib/use-hub'
import { useLayout } from '@/lib/use-layout'

const viewKey = 'wiim-hub:view'

const readView = (): View => {
  try {
    return localStorage.getItem(viewKey) === 'diagnostic' ? 'diagnostic' : 'user'
  } catch {
    return 'user'
  }
}

const writeView = (view: View): void => {
  try {
    localStorage.setItem(viewKey, view)
  } catch {
    // private mode: the choice still applies for this session
  }
}

const LoadingCards = () => (
  <>
    {[0, 1].map(index => (
      <Card key={index} className="p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-4 w-20 rounded-full" />
        </div>
        <div className="mt-4 flex gap-4">
          <Skeleton className="size-24 shrink-0 rounded-xl sm:size-32" />
          <div className="flex flex-1 flex-col justify-center gap-2">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
        <Skeleton className="mt-5 h-1 w-full rounded-full" />
      </Card>
    ))}
  </>
)

const Hub = () => {
  const { t } = useSettings()
  const hub = useHub()
  const [view, setView] = useState<View>(readView)
  const [now, setNow] = useState(() => Date.now())

  const devices = hub.state?.devices ?? []
  // A running group is one player, so the page draws (and orders) one card for
  // it: the partition decides which speaker drives which, from what the hub
  // confirmed, and the layout follows the cards rather than the speakers.
  const cards = fleetCards(devices)
  // The order and the folded cards are a preference of this browser: the hub
  // keeps no such thing, and both views read the same list. The diagnostic view
  // still draws one card per speaker, in the order the groups gave the masters
  // and with the members appended.
  const layout = useLayout(cards)
  const ordered = layout.devices
  const orderedDevices = sortDevices(
    devices,
    ordered.map(card => card.ip)
  )
  // The cards render a photo of the hub, so their clock stops at the moment it
  // was taken: a seek bar must not advance on a position nobody measured. The
  // banner keeps the real clock, because it dates the photo.
  const clock = hub.error === null ? now : (hub.shownAt ?? now)
  const offline = devices.filter(device => !device.online).length
  const online = devices.length - offline

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // The tab title carries the alert, so a pinned tab shows trouble without a
  // visit: a count in front of the product name, as a mail client does.
  useEffect(() => {
    document.title = offline > 0 ? `(${offline}) ${t('title')}` : t('title')
  }, [offline, t])

  useEffect(() => {
    writeView(view)
  }, [view])

  const discover = async (): Promise<void> => {
    try {
      const added = await hub.discover()
      if (added > 0) toast.success(t('added', { count: added }))
      else toast(t('noNewDevice'))
    } catch {
      toast.error(t('discoveryFailed'))
    }
  }

  const lineOf = (device: Device): string => {
    if (!device.online) return `${device.name}: ${t('offline')}`
    // An external input announces the source, the same words the card shows.
    if (isExternalInput(device.input)) {
      return `${device.name}: ${inputLabel(t, device.inputLabels, device.input)}`
    }
    return `${device.name}: ${device.title === '' ? t('noPlayback') : device.title}`
  }

  // A group is announced as what it is on screen: the master plays, the members
  // follow it, and a named member the fleet cannot poll says so. Announcing the
  // master's track once per member would read the same sentence three times.
  const announce = ordered
    .flatMap(card => {
      const members = [
        ...card.members.map(member =>
          member.online
            ? `${member.name}: ${t('group.follows', { name: card.master.name })}`
            : lineOf(member)
        ),
        ...card.absent.map(member => `${member.name}: ${t('group.unknown')}`),
      ]
      return [lineOf(card.master), ...members]
    })
    .join('. ')

  return (
    <div className="flex min-h-dvh flex-col">
      <Header
        view={view}
        onChangeView={setView}
        onDiscover={() => void discover()}
        onHostsChanged={hub.refresh}
        discovering={hub.discovering}
        online={online}
        total={devices.length}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>

        <div className="space-y-4">
          <UpdateBanner />

          {hub.error !== null && <HubBanner onRetry={hub.refresh} since={hub.shownAt} now={now} />}

          {hub.loading && hub.state === null && (
            <div className="grid gap-4 xl:grid-cols-2">
              <LoadingCards />
            </div>
          )}

          {/* With the hub silent there is nothing to discover: offering the
              button would fail, so the banner above is the only answer. */}
          {hub.error === null && !hub.loading && devices.length === 0 && (
            <EmptyState onDiscover={() => void discover()} discovering={hub.discovering} />
          )}

          {ordered.length > 0 &&
            (view === 'user' ? (
              <div
                className={cn(
                  ordered.length > 1
                    ? 'grid items-start gap-4 xl:grid-cols-2'
                    : 'mx-auto max-w-3xl space-y-4'
                )}
              >
                {ordered.map((card, index) => (
                  // Keyed by the card's address, not by name: a speaker that
                  // renames itself, or one renamed from its sheet, would
                  // otherwise remount the card and close the sheet under the
                  // hand. A group is keyed on its master, so the card survives
                  // a member joining or leaving.
                  <div key={card.ip} className="space-y-4">
                    <NowPlayingCard
                      card={card}
                      now={clock}
                      fleet={devices}
                      index={index}
                      count={ordered.length}
                      membersCollapsed={layout.groupsCollapsed.has(card.ip)}
                      onToggleMembers={() => layout.toggleGroup(card.ip)}
                      onMove={delta => layout.move(card.ip, delta)}
                      onGroupChanged={hub.refresh}
                    />
                    {/* A group's speakers are rows, and each row opens the
                        sheet of that room: its equalizer is one gesture away,
                        under the name of the speaker it changes. The sound card
                        under the group would repeat the master's equalizer on
                        the page the reader lands on. A solo card keeps it: the
                        card is its only way in. */}
                    {!drivesGroup(card) && <SoundCard device={card.master} />}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {orderedDevices.map(device => (
                  <DiagnosticCard
                    key={device.ip}
                    device={device}
                    now={clock}
                    collapsed={layout.collapsed.has(device.ip)}
                    onToggleCollapsed={() => layout.toggle(device.ip)}
                  />
                ))}
              </div>
            ))}
        </div>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-muted-foreground sm:px-6">
          <span className="hidden sm:inline">{t('subtitle')}</span>
          <span className="tabular-nums">
            {devices.length > 0 && hub.state !== null
              ? t('polled', { seconds: Math.round(hub.state.pollMs / 1000) })
              : '—'}
          </span>
        </div>
      </footer>

      <Toaster />
    </div>
  )
}

export const App = () => (
  <SettingsProvider>
    <Hub />
  </SettingsProvider>
)
