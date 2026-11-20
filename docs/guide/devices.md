# Devices

The hub talks to every player the same way: the local HTTP interface the firmware exposes. What
differs between models is which commands answer, and the hub asks rather than assumes.

## An explicit list

`DEVICE_HOSTS` is the authoritative list, comma separated, one entry per speaker:

```sh
DEVICE_HOSTS=192.168.1.10,living-room.local,kitchen
```

An entry is either an address or a name:

- **an address** is used as is. Give the speaker a DHCP reservation if you want it to stay.
- **a name** is resolved by a chain: the pairs in `DEVICE_STATIC_HOSTS`, then the lease file in
  `DEVICE_LEASES_FILE` when the hub can read one, then the system resolver, then a dependency-free
  mDNS query (`kitchen.local` answers on the LAN even when the host has no avahi or
  systemd-resolved configured). If a re-resolution fails, the last known address is kept, so a DHCP
  lease change is invisible rather than a device that disappears. The diagnostic report names the
  source that answered. See [Configuration](/guide/configuration#names).

Names are worth the extra step when your router hands out addresses freely: the hub follows the
name, not the lease.

## Adding a host from the page

The devices dialog, behind the server icon in the header, lists every address the hub polls and
says where each one came from:

| Source           | What it means                                | What the page can do       |
| ---------------- | -------------------------------------------- | -------------------------- |
| from environment | an entry of `DEVICE_HOSTS`                   | nothing: it is the seed    |
| saved            | added from the page, written to `HOSTS_FILE` | change the address, remove |
| discovered       | found by the SSDP pass                       | keep it, which saves it    |

A saved entry survives a restart; a discovered one comes back on the next scan anyway, which is why
removing it changes nothing and the hub says so instead of pretending.

Two rules come with the list:

- **One card per machine.** An address that resolves to a speaker already in the list is refused,
  naming the entry it clashes with. Discovery applies the same rule, so a name and its address
  never become two cards with two write queues.
- **Changing an address is a new entry.** The history belonged to the old one, so the card starts
  empty rather than inheriting samples that were measured somewhere else.

In Docker, mount a volume over the directory of `HOSTS_FILE`: the container otherwise writes the
list into its own layer, and the next recreation loses it.

## Discovery

`DISCOVERY=1` (the default) adds a best-effort SSDP pass: an M-SEARCH for MediaRenderer devices,
then a read of each description, kept when the answer names WiiM or LinkPlay. The button in the
header runs one pass on demand and polls immediately after.

Discovery only enriches the list. It is not a source of truth:

- multicast does not cross every container network, and a bridged container sees nothing;
- a sleeping player may not answer within the timeout;
- a device found by discovery and also configured by name is kept once, not twice.

If the hub runs in Docker with the default bridge, keep `DEVICE_HOSTS` explicit.

## A mixed fleet

The transport is probed per device: https on 443 first, http on 80 as a remembered fallback.
Firmware generations differ on this, and the hub pays at most one extra request per device to find
out. Capabilities are probed the same way: a command that answers `unknown command` is recorded as
unsupported for that device, and the matching control is shown as unsupported instead of being
retried on every click.

Consequences worth knowing:

- A model that does not report a given field shows it as unknown. Missing keys are tolerated, not
  treated as errors, because the firmware genuinely omits them.
- Inputs and outputs come from the device (`getSoundCardModeSupportList`,
  `getAudioInputCapbility`), so the source picker offers what that unit accepts.
- Every level stays on the protocol's 0-100 scale. The `max_volume` a device reports is a setting the vendor app exposes, not a hardware stop: one Mini here reports 40 while sitting at 54, so it never bounds a slider or a group gesture.

## One card per player

A card is what you hear, not what answers: a speaker alone, or a group, which is one player driven
by its master and rendered by the speakers that follow it. Cards are ordered by name and the order
belongs to the browser, so the arrows move one card against its neighbour. Every device keeps its
own state, its own write queue and its own poll. A device that stops answering keeps its card,
marked offline, with its last known values and the number of failed polls: a speaker pulled off the
mains is a case to show, not to hide. The diagnostic view still draws one card per speaker, since
that view is about what each device answered.

## Multiroom

The hub shows the role a speaker claims (master, member, none), the group name and its members,
read from `multiroom:getSlaveList` and `multiroom:getnamegrouplist`. Two details it refuses to
flatten:

- a saved group that is not running is reported as such, not as a running group;
- a remembered member with no address reports an unknown state, not a fake offline one.

A member answers very little about its group: its own registry is empty, because the group is
remembered on the speaker that drives it, and its transport reads `mode 99, stop` with no track,
because the stream runs on the master. Read alone, such a speaker looks like a stopped player in no
group. The hub polls the whole fleet, so it completes the picture from the master's own answer, and
draws the group as one card: the group's name heads it, the speaker that drives it sits under it,
and every speaker is a row with its own level, the master included — the level at the top of the
card is the group's, fanned out, so the room that drives the group needs a level of its own.
A member that plays something of its own keeps its own card, because its answer wins over the group
it is supposed to follow. The copy lives in a separate `mirror`, so the diagnostic view and the
exported report still say what the device itself answered.

The transport is not offered on a member. A command sent to a member drives its own silent input,
not the group, and the hub does not write to another speaker on your behalf. Volume stays: it is the
member's own, and the master reports it in its slave list. A button on the row opens that speaker's
own sheet, with its volume, its equalizer, its source, its sleep timer, its output, a stream URL and
its presets, which is what its card used to carry. The master's row opens the same sheet, so the
group card carries no sound card of its own:
the equalizer of the speaker that drives the group would otherwise sit twice on the same page, one
gesture apart. A speaker that drives no group keeps the sound card under its player, where it is the
only way in.

The source sits in that sheet too, for the master as well: a group is a stream, not an input, and
only the speaker itself has one to switch. The vendor app keeps the picker in the same place for the
same reason. A source that is not a physical input still reads as the network one, because a cast or
a service Connect session is exactly what `switchmode:wifi` would return to, and leaving the row
with nothing lit while the room plays reads as a control that lost its state.

The sleep timer, the output route, the stream URL and the presets follow the source: each one acts on
a single speaker, so the card of a running group carries none of them, and every row opens them in
its sheet. A card of a speaker that drives no group keeps them under its player, because that card is
that speaker.

A group is folded only when it currently runs: a saved group that is not running, and a group whose
master stopped answering, leave the speakers on their own cards, since nothing confirms that the
group is live. A member the master names and the fleet cannot poll keeps a row with its name and an
unknown state, so the count stays honest instead of silently dropping it.

The "no sound" flow reads the group's transport for the same reason: asking a member why it is
stopped would name a cause that does not exist while the room plays. The flow also drops the output
check on such a speaker, because the sound does not leave through an output it chose.

### Driving a group

The card of a running group carries the volume and the mute of what the reader hears, and no two
gestures take the same path. Each follows a measurement in
[the research notes](../feature-research.md), section 5.8.1:

- **Volume fans out, in proportion, from the loudest room.** `setPlayerCmd:vol` on the master moves
  the master alone, and `setPlayerCmd:slave_vol` does no better. The level carries that of the
  loudest speaker the hub still reads, so a group kept at 40 in one room and 60 in another turns on
  the room at 60. The hub sends every speaker its level, each scaled from that anchor's level before
  the write: a room kept at two thirds of it stays at two thirds, so moving the group keeps the
  balance the reader set one room at a time instead of levelling every speaker. A scaled level is
  clamped at that speaker's own ceiling rather than refused, a speaker at zero stays at zero, and a
  gesture with nothing to scale against (no speaker read yet) lands as asked. A speaker the fleet
  cannot read keeps its last level on screen but never carries the gesture: nothing would move it.
  A muted room leaves the gesture the same way: its row stays on screen, greyed, and keeps the
  level it will come back to, because nothing is written to a silenced speaker while the group moves.
  There is no level the group knows; the row of each speaker settles that room alone.
- **Mute has two scopes, and two wires.** The button above the list carries the group: one LinkPlay
  write on the master, because that mute reaches the members, and its state is the one every online
  speaker reports rather than the master's own. Every row carries a mute of its
  own, the master's included, and each of them silences one room: sent over LinkPlay, the master's
  row mute would have reached the whole group, so a room mute leaves by UPnP
  `RenderingControl.SetMute`, which silences the speaker it is addressed to and nobody else
  (measured 20/11, the members stay at `mute=0`).

A drag writes while the thumb moves. The page paints every row from the anchor as the hand goes and
sends the level as it changes, one write in flight and a short beat between two, so the rooms follow
instead of waiting for the release; above the confirmation threshold nothing is sent until the reader
agrees. Releasing sends the level once more, and the hub reads the fleet back, which is where the
painted levels give way to what the speakers report.

### Setting a level

Every level on the page is a row that opens a track wide enough for a thumb. A drag lands on the
next multiple of five, a tap on either side of the thumb moves one step, and a tap on the thumb
itself moves nothing. The keyboard carries both steps: the arrows move one, Page Up and Page Down a
crank, Home and End the bounds. The readout above the track follows the gesture before the write
leaves, and past the loud level it shows the level asked for while nothing is written until the
reader confirms. A row-wide track was too narrow to aim at on a phone, and one step at a time was
too slow across the scale; the pop-in is the dial the vendor app opens, with the two gestures on one
track.

### Forming and breaking a group

Three gestures, each sent to the speaker that owns the write:

- **Join**: a speaker that follows nothing offers the speakers it can join. The write goes to the
  joining speaker and names the master by address and uuid, which is what the firmware matches on.
- **Remove**: the sheet of a member takes that speaker out of the group, through the master's kick.
- **Dissolve**: the panel of the group card stops the group. A member's panel offers to leave it
  instead, which is the card it keeps while its master is away.

A membership change is not instantaneous on the firmware: the joining speaker registers first, and
the master publishes its list after it. The hub reads the fleet back until the group moves before it
answers, so the page never shows the group the reader just left. A join is refused rather than sent
when the speaker already follows a group the fleet can see, when the chosen master is offline or
published no uuid, and when the speaker is already a member of that group.

## External inputs

An optical or line input is a source without a track. The firmware keeps replaying the last
position it knew, and the metadata answers `unknow`. The hub reports the input as the source and
hides the player, rather than presenting a stale position as if something were playing.
