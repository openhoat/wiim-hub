# Configuration

The server reads `.env` from the working directory when it exists (`start` and `start:server`);
inside Docker the variables come from the compose file or from `docker run -e`. A variable set in
the environment wins over the file.

| Variable        | Default | Meaning                                                                                         |
| --------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `PORT`          | `8090`  | HTTP port of the hub                                                                            |
| `POLL_MS`       | `3000`  | Polling period, floor 1000 ms                                                                   |
| `SLOW_POLL_MS`  | `15000` | Polling period while every device pushes its events, floor `POLL_MS`                            |
| `UPNP_CALLBACK` | empty   | Base URL the players can reach the hub on, e.g. `http://192.168.1.10:8091`; enables UPnP events |
| `UPNP_PORT`     | `8091`  | Port of the event callback listener, separate from `PORT`                                       |
| `DEVICE_HOSTS`  | empty   | Comma separated device addresses or names, authoritative list; one entry per speaker            |
| `DISCOVERY`     | `1`     | SSDP discovery, best effort, set `0` to disable                                                 |
| `HUB_VERSION`   | `dev`   | Version string written in the diagnostic report; the image carries no `package.json` at runtime |

## The three that matter

**`DEVICE_HOSTS`** is the list the hub trusts. Every entry is a speaker: an address
(`192.168.1.10`) or a name (`kitchen.local`, `kitchen`). Discovery only adds to it, and a device
seen twice is kept once. See [Devices](/guide/devices).

**`POLL_MS`** is the heartbeat. Three seconds is the default because the page extrapolates the
playback position between polls, and a slower poll is visible as a jump. The floor is one second:
below that, a small embedded HTTP server starts answering late more often than it answers fresh.

**`UPNP_CALLBACK`** is the only variable that changes how the hub talks to the players. Leave it
empty unless the speakers can reach the hub at that address: with a value they cannot reach, the
players are subscribed to a URL that never answers, and the poll falls back anyway. See
[UPnP events](/guide/events).

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
write. Nothing is persisted; a restart loses the sample history and the event log, which is the
intended scope of a hub that only reads.
