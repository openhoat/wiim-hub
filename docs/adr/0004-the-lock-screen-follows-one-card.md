# 0004 — The lock screen follows one card

- Status: accepted
- Date: 2026-11-20

## Context

The page is used from a phone, in a room, with the screen off. The speakers keep playing, and every
gesture then costs unlocking the phone, finding the tab and pressing a button. The browser exposes
the Media Session API for exactly that: a page can publish what it plays, and the lock screen offers
the transport without the page being visible.

The fleet is several speakers with one card each, and a group renders one card whose members are
rows. A media session is a singleton per page: it has one metadata, one playback state, one
position, and one handler per action. So the question is not how to publish the fleet, it is which
card the fleet is summarised by.

## Decision

One component owns the session (`src/components/media-session.tsx`), mounted outside both views so
switching to the diagnostic view does not clear the player. It publishes the card `mediaCard` picks:
the first card in the page's order that plays, otherwise the first that carries a track, and nothing
when the fleet is silent.

The name of the card travels in the album slot, so a group is announced as the room rather than as
the speaker driving it. The cover is resolved to an absolute address: the hub relays it, and the
speaker serves plain http on another origin, which a lock screen will not fetch.

The transport handlers send the same writes as the buttons of the card, through the same
`useControls`. The lock screen offers no volume and no mute, so the group routing that a volume
gesture needs never applies here. A seek is refused on a stream without a duration, and a target is
clamped into the track: the lock screen must not be able to ask for a position the speaker cannot
play.

## Consequences

- The pure part lives in `src/lib/media-session.ts` (metadata, playback state, position, the
  gesture-to-command mapping) and is covered by the unit suite; the hook only narrows the browser
  singleton, tolerates a browser without `setPositionState`, and a browser without the API keeps the
  page it had. Nothing to configure.
- A title that empties between two tracks (measured: about four seconds) would blink the player
  away, so the metadata effect skips an empty title and the previous track stays on the lock screen.
- The published card follows the page's order, which is the order the reader chose: moving a card
  changes what the lock screen announces, and that is the only lever.
- The browser suite drives the captured handlers and checks the write on `/api/state`, which is why
  the test proves a gesture rather than the shape of a session.
