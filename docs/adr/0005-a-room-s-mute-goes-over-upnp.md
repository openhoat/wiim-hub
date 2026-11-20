# 0005 — A room's mute goes over UPnP

- Status: accepted
- Date: 2026-11-20

## Context

The mute button of a group card silences what the reader hears. The rows under the card are one
per speaker, the master's included, and each row carries its own mute. Users read that row as "this
room", and reported the opposite: muting the room that drives the group silenced every other room
too.

The cause is measured, not guessed. `setPlayerCmd:mute:<0|1>` sent to a group master propagates to
the members and to the member list (§5.8.1), so the write behind a row mute on the master is a group
gesture. `multiroom:SlaveMute`, the documented way to reach a member, answers `OK` and does nothing
when it is addressed to the master.

A group mute is still a real gesture: one write, no fan-out, and it reaches rooms whose own mute
path is not always available. So the hub needs both, and the two must not be the same write.

## Decision

Two writes, chosen by scope, on the server so both routes agree:

- **A room's mute** (`action: 'mute'`, the route every row and every solo card uses) leaves by UPnP:
  `POST http://<ip>:49152/upnp/control/rendercontrol1`,
  `SOAPACTION: "urn:schemas-upnp-org:service:RenderingControl:1#SetMute"`,
  `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>0|1</DesiredMute>`. Measured on
  the Pro (master of three) and on a Mini: the speaker is silenced alone, the members keep `mute=0`,
  and the next `getPlayerStatus` reports `mute=1`, so the poll sees the write like any other. TLS is
  refused on that port; the hub speaks plain http to it, as it already does for the event
  subscription and the device description.
- **The group's mute** (`POST /api/group`, `{ intent: 'mute', muted }`) stays the LinkPlay write on
  the master, whose propagation is the whole point: one request, every room.

The write queue carries the wire, not a command string (`DeviceWrite` in `server/commands.ts`), and
answers a label per wire: the LinkPlay command, or `upnp:SetMute:<0|1>`. Both are read by
`outcomeFor`: a LinkPlay body keeps its `unknown command` reading, a SOAP answer is a success unless
it carries an `<errorCode>`.

On the page, the player above a group's list carries the group's mute and is named after the group
("Mute Apartment"), while each row is named after its speaker ("Mute Hallway"). The button's state is
the group's state, not the master's own: every online speaker has to report `mute=1`, otherwise a
single silenced room would make the group look silent.

## Consequences

- The `mute` action no longer means "whatever the firmware does": it means one speaker. A caller that
  wants the group goes through the group route, which is also the only place that fans a gesture out.
- The demo follows the hub: a device mute sets that speaker's flag, the group intent propagates, so
  the browser suite proves both scopes on the simulated fleet.
- A speaker that stops publishing `RenderingControl` would lose its row mute. The description is
  already read for the model (`server/device/model.ts`), so the service is known to exist on the
  firmware the hub supports; the failure is a SOAP fault, reported like a refused write.
