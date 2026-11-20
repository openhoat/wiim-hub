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

## Addendum: a page has to make a sound to be a player (2026-11-20)

The first release set the session and the handlers and nothing appeared on the lock screen of an
Android phone. Measured cause: Chrome builds the media notification for a tab that plays audio, not
for a page that merely describes one. The hub makes no sound, because the music leaves by the
speakers, so the phone treated the tab as a remote control and never built a player.

The page now carries an inaudible one: `quietTrack()` builds half a minute of a sine as a mono WAV,
played by a looping `<audio>` element at volume `0.4`, so the phone renders nothing at any volume
setting of its own. The element plays while the published card plays and stays paused otherwise,
which keeps the notification of a paused stream and stops the page from pretending to play when
nothing does.

The level is the whole difficulty, and the first attempt missed it. A track at about -72 dBFS still
showed nothing: Chrome does not test for digital silence, it watches the output power.
`services/audio/output_stream.cc` holds the line at `kSilenceThresholdDBFS`, -72.24719896 dBFS, and
a stream under it is reported silent, so the tab never becomes a player.
`media/base/audio_power_monitor.cc` averages the raw samples and filters nothing, so the frequency
of the signal does not matter to the meter. The track therefore sits at forty hertz, a frequency no
phone speaker renders, at about -53 dBFS with the element volume applied: nineteen decibels above
the line, and twenty-seven without the volume, so it passes whichever side of the mixer the meter
reads. The ear stays out of it.

The length then cost a third attempt. With the level fixed, the player still never appeared, and a
probe served from the hub's own origin narrowed it in one pass: a thirty second file served over the
network showed the player, the same file handed over as a blob showed it too, a two second blob in a
loop showed nothing, and repeating the experiment with and without a media session, at 8 and 48 kHz,
with and without the `loop` attribute, changed nothing. Duration was the only variable left: Chrome
discards a sound it reads as too short to be playback. Two seconds fail, thirty pass, and the
threshold lies between the two; the track takes the wide side of that gap rather than chase the
frontier. Half a minute holds twelve hundred whole cycles of forty hertz, so the loop seam still
falls on a zero crossing and does not click.

A browser that has not seen a gesture refuses to start a sound, so the page arms the first pointer
down rather than asking the reader for one: the music is already playing, nothing on screen should
have to be pressed. The tab must stay open, which every page that publishes a media session
inherits.

The lock screen of the test phone (Pixel 9 Pro) showed no media player for any application, YouTube
Music included, while the unlocked shade showed the same players. That is a setting of the phone
rather than something a page can change: the player exists, and the phone chooses where to display
it. The session and the track are therefore validated in the shade, and the lock screen follows the
device's own policy.
