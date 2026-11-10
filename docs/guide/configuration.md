# Configuration

The server reads `.env` from the working directory when it exists (`start` and `start:server`);
inside Docker the variables come from the compose file or from `docker run -e`. A variable set in
the environment wins over the file.

| Variable              | Default           | Meaning                                                                                         |
| --------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| `PORT`                | `8090`            | HTTP port of the hub                                                                            |
| `POLL_MS`             | `3000`            | Polling period, floor 1000 ms                                                                   |
| `SLOW_POLL_MS`        | `15000`           | Polling period while every device pushes its events, floor `POLL_MS`                            |
| `UPNP_CALLBACK`       | empty             | Base URL the players can reach the hub on, e.g. `http://192.168.1.10:8091`; enables UPnP events |
| `UPNP_PORT`           | `8091`            | Port of the event callback listener, separate from `PORT`                                       |
| `DEVICE_HOSTS`        | empty             | Comma separated device addresses or names, the seed list; one entry per speaker                 |
| `DEVICE_STATIC_HOSTS` | empty             | Fixed `name=address` pairs, asked first when a name is resolved                                 |
| `DEVICE_LEASES_FILE`  | empty             | dnsmasq lease file the hub may read, asked second when a name is resolved                       |
| `HOSTS_FILE`          | `data/hosts.json` | Where the hosts added from the page are written; `DEVICE_HOSTS` stays read only                 |
| `NOTIFY_WEBHOOK`      | empty             | URL that receives one JSON object per alert; enables the webhook channel                        |
| `NOTIFY_NTFY`         | empty             | ntfy topic URL, posted as text with a title and a priority; enables the ntfy channel            |
| `NOTIFY_NTFY_TOKEN`   | empty             | Bearer token for a protected ntfy topic                                                         |
| `NOTIFY_RULES`        | empty             | Comma separated rule ids to send, empty meaning all of them                                     |
| `NOTIFY_MIN_SEVERITY` | `warn`            | Lowest severity sent, `info`, `warn` or `alert`                                                 |
| `NOTIFY_QUIET_MS`     | `3600000`         | How long a rule that cleared stays silent before it may speak again                             |
| `DISCOVERY`           | `1`               | SSDP discovery, best effort, set `0` to disable                                                 |
| `HUB_VERSION`         | `dev`             | Version string written in the diagnostic report; the image carries no `package.json` at runtime |

## The four that matter

**`DEVICE_HOSTS`** seeds the list the hub trusts. Every entry is a speaker: an address
(`192.168.1.10`) or a name (`kitchen.local`, `kitchen`). Discovery only adds to it, and a device
seen twice is kept once. It is read, never written: an entry that comes from it is marked as such
and cannot be removed from the page. See [Devices](/guide/devices).

**`HOSTS_FILE`** is where the hosts added from the page are saved, `data/hosts.json` next to the
sources by default. It is the only file the hub writes, and the only state it keeps across a
restart: a deployment mounts a volume over that directory. The file is plain JSON, so it can be
edited by hand while the hub is stopped:

```json
{ "hosts": ["192.168.1.10", "kitchen.local"] }
```

**`POLL_MS`** is the heartbeat. Three seconds is the default because the page extrapolates the
playback position between polls, and a slower poll is visible as a jump. The floor is one second:
below that, a small embedded HTTP server starts answering late more often than it answers fresh.

**`UPNP_CALLBACK`** is the only variable that changes how the hub talks to the players. Leave it
empty unless the speakers can reach the hub at that address: with a value they cannot reach, the
players are subscribed to a URL that never answers, and the poll falls back anyway. See
[UPnP events](/guide/events).

## Names

A name (`kitchen`, `kitchen.local`) is resolved by a chain of sources, in order, and the first
answer wins:

1. **`DEVICE_STATIC_HOSTS`**, the pairs you wrote down: `kitchen=192.168.1.10,studio=192.168.1.11`.
   Matched as written, in any case. When someone writes the address down, nothing should argue.
2. **`DEVICE_LEASES_FILE`**, the lease table of a dnsmasq-family router (Pi-hole, OpenWrt, most
   firmwares) the container may read. Matched by the full hostname, then by its first label, so
   `kitchen` finds a `kitchen.local` lease. The file is read at most once a minute, an expired lease
   is dropped, and `0` is the infinite one.
3. **the system resolver**, the fast path on a host running nss-mdns.
4. **a built-in mDNS query**, which answers `.local` even when nothing on the host does.

A chain rather than one mechanism, because no single source covers a home network: a container on a
bridge does not see multicast, a container is often blind to the host resolver, and the router that
handed the address out already knows it. Each source is optional and the chain degrades to what it
can see.

Three timings are deliberate: an answer is kept for 30 s, a name that answered nothing is asked
again after 60 s, and two polls closer than 5 s apart never both query. A failed resolution keeps
the last known address, so a lease change stays invisible instead of making the card disappear.

The diagnostic report says which source answered: `Probe path: kitchen → 192.168.1.10, resolved by
dhcp leases over https.` That is the line that tells a support thread whether mDNS is the suspect at
all.

## Alerts

`NOTIFY_WEBHOOK` and `NOTIFY_NTFY` are off until one of them has an address. Both take one alert per
rule that appears, never the same one twice while it stays, subject to a quiet period:
[Notifications](/guide/notifications) covers the filters and the message shapes.

## Behind a reverse proxy

The hub has **no built-in authentication, by design**: identity belongs to the ingress. Run it on a
private network, or put a forward-auth proxy in front of it, such as oauth2-proxy or Authelia.

Two rules come with that:

- Keep `/health` reachable without a session if your probe or your orchestrator needs it. It
  answers `ok` and nothing else, and it is the only route that reads no device.
- The control routes write to the speaker. A hub exposed without an authentication layer is not a
  supported configuration.

Album art is fetched by the hub, not by the browser, so the page works over https even when the
speaker serves its cover over plain http on the LAN. No CORS setting is needed on the device.

## Sizing

One process, one poll loop, a few hundred kilobytes of ring buffer per device: 400 signal samples
and the last events. Memory stays under a hundred megabytes for a handful of speakers. The image is
`linux/amd64` only; on another architecture, build it from sources.

## Logs

The process writes to stdout: one line per discovery pass, per subscription change and per refused
write. Apart from `HOSTS_FILE`, nothing is persisted: a restart loses the sample history and the
event log, which is the intended scope of a hub that only reads.
