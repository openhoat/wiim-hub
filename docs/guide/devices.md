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
- The volume ceiling is the device's own `max_volume`, not a constant.

## One card per speaker

Cards are ordered by name, and every device has its own state, its own write queue and its own
poll. A device that stops answering keeps its card, marked offline, with its last known values and
the number of failed polls: a speaker pulled off the mains is a case to show, not to hide.

## Multiroom, read only

The hub shows the role a speaker claims (master, member, none), the group name and its members,
read from `multiroom:getSlaveList` and `multiroom:getnamegrouplist`. Two details it refuses to
flatten:

- a saved group that is not running is reported as such, not as a running group;
- a remembered member with no address reports an unknown state, not a fake offline one.

A member answers very little about its group: its own registry is empty, because the group is
remembered on the speaker that drives it, and its transport reads `mode 99, stop` with no track,
because the stream runs on the master. Read alone, such a speaker looks like a stopped player in no
group. The hub polls the whole fleet, so it completes the picture from the master's own answer: the
member card carries the group name, the member list and the speaker it follows, and it shows the
track the master is playing, labelled with where that reading comes from. The member's own fields
are left alone. The copy lives in a separate `mirror`, so the diagnostic view and the exported
report still say what the device itself answered.

The transport is not offered on a mirrored card. A command sent to a member drives its own silent
input, not the group, and the hub does not write to another speaker on your behalf. Volume stays:
it is the member's own, and the master reports it in its slave list.

The "no sound" flow reads the group's transport for the same reason: asking a member why it is
stopped would name a cause that does not exist while the room plays. The flow also drops the output
check on such a speaker, because the sound does not leave through an output it chose.

No multiroom write control is rendered: forming a group, adding a member and driving the group's
transport from another speaker are the commands the hub does not offer, because a button it cannot
verify is worse than no button.

## External inputs

An optical or line input is a source without a track. The firmware keeps replaying the last
position it knew, and the metadata answers `unknow`. The hub reports the input as the source and
hides the player, rather than presenting a stale position as if something were playing.
