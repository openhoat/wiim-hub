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
- **a name** is resolved on each poll cycle, in two steps: the system resolver first, then a
  dependency-free mDNS query (`kitchen.local` answers on the LAN even when the host has no
  avahi or systemd-resolved configured). If a re-resolution fails, the last known address is kept,
  so a DHCP lease change is invisible rather than a device that disappears.

Names are worth the extra step when your router hands out addresses freely: the hub follows the
name, not the lease.

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

No write control is rendered until a second unit can be measured: the group commands were never
exercised against a real pair, and the hub does not offer a button it cannot verify.

## External inputs

An optical or line input is a source without a track. The firmware keeps replaying the last
position it knew, and the metadata answers `unknow`. The hub reports the input as the source and
hides the player, rather than presenting a stale position as if something were playing.
