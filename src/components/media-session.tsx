import { cardTitle, type FleetCard } from '@/lib/cards'
import { useControls } from '@/lib/use-controls'
import { useMediaSession } from '@/lib/use-media-session'

// One card of the page owns the lock screen, and it is the only writer of the
// media session: a second one would fight it for the same singleton. The
// transport is the card's own, through the same hook, so a play pressed on the
// lock screen is the play button of the card, with its optimistic update.
const Published = ({ card, now }: Readonly<{ card: FleetCard; now: number }>) => {
  const controls = useControls(card.master)
  useMediaSession({
    publish: true,
    device: controls.device,
    run: controls.run,
    title: controls.device.title,
    album: cardTitle(card),
    now,
  })
  return null
}

export const MediaSession = ({ card, now }: Readonly<{ card: FleetCard | null; now: number }>) =>
  card === null ? null : <Published card={card} now={now} />
