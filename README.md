# WiiM Hub

Read-only hub for WiiM devices (and other LinkPlay-based players) on a local network: what each
device is playing, and what it reports about itself, polled every few seconds and served as a
small web page.

A local, self-hosted complement to the vendor app. v1 **observes only**: it never writes to a
device. Remote control and multiroom are roadmap items, not promises.

## Why a second view

The router sees an association; the device reports what it thinks it is: its own signal reading,
the SSID it joined, the BSSID it landed on, what it is playing. When a unit misbehaves, the two
views diverge, and the device side is the one the official app consumes.

## Features

- Several devices side by side, polled in parallel.
- Per-device transport: https/443 first, http/80 fallback remembered, so a mixed firmware fleet
  costs at most one extra request per device.
- Devices configured by address or by name (`salon.local`): the built-in mDNS resolver (system
  resolver first, then a dependency-free multicast query) keeps a DHCP lease change invisible, and
  the last known address is retained when a re-resolution fails.
- SSDP discovery as a best-effort complement to an explicit device list.
- **Two views on the same data**: a *now playing* view for everyday use (art, track, progress,
  playback state, volume, group size, offline badge) and a *diagnostic* view for support (raw
  fields, RSSI sparkline, event log, sample table, CSV export). The selected view is remembered
  per browser.
- Now playing: track, artist, album, album art (relayed by the hub, see below), playback progress
  extrapolated between polls, playback source badge, playback state, volume.
- RSSI history (400 samples, about 20 minutes at 3 s) with a sparkline, an event log (reachability,
  playback state, track changes), a weak-signal and offline indicator, and a count badge in the
  tab title.
- Per-device details: sample table, JSON export and CSV export, copy of the device address.
- Minimal i18n: English and French labels, picked from the browser, English fallback. Language and
  theme choices are remembered in `localStorage`.

## Local API notes

Measured on a WiiM Pro, firmware `Linkplay.4.8.833748`, release `20261027`:

- Local API on **https / 443**, port 80 closed on that build. Older builds answer on http / 80.
- Self-signed certificate, requests run with `rejectUnauthorized: false`.
- Some fields are hex-encoded (`essid`, `Title`): decoded when the bytes read as text.
- `getStatusEx`, `getPlayerStatusEx` and `getMetaInfo` answer; `getVolume`, `getEQ` and `getInfo`
  do not on that firmware, so missing keys are tolerated rather than treated as errors.
- No CORS header: a browser cannot call the device directly, hence this hub.
- Album art arrives as an absolute URL (sometimes an external streaming host): the hub fetches it,
  the browser never talks to the speaker or to the streaming CDN.

The endpoints live under `/httpapi.asp?command=<name>`; the family is documented by the
community, not by the vendor, so the client is defensive by design.

## Run with Docker

```sh
docker build -t wiim-hub .
docker run --rm -p 8090:8090 -e DEVICE_HOSTS=192.168.1.10 wiim-hub
```

Or use [`examples/compose.yml`](examples/compose.yml):

```sh
cd examples && docker compose up -d
```

Discovery uses SSDP multicast, which does not cross every container network. With the default
bridge, set `DEVICE_HOSTS` explicitly; use `network_mode: host` if you want discovery to work.

## Run from sources

The UI is a React application built by Vite; the server is plain TypeScript. Node 22.18+ runs the
server sources directly (type stripping), so only the UI needs a build.

```sh
npm ci
npm run build                                  # writes dist/
PORT=8090 DEVICE_HOSTS=192.168.1.10 npm start   # server + built UI on :8090
```

For UI work, run the two processes side by side: `npm run start:server` (API on :8090, restarts on
change) and `npm run start:dev` (Vite on :5173, proxies `/api` and `/health` to the API).

Then open <http://localhost:8090>, or <http://localhost:5173> in development.

## Configuration

| Variable       | Default | Meaning                                                  |
| -------------- | ------- | -------------------------------------------------------- |
| `PORT`         | `8090`  | HTTP port of the hub                                     |
| `POLL_MS`      | `3000`  | Polling period, floor 1000 ms                            |
| `DEVICE_HOSTS` | empty   | Comma separated device addresses or names, authoritative list |
| `DISCOVERY`    | `1`     | SSDP discovery, best effort, set `0` to disable          |

## Endpoints

- `GET /health`: liveness, for container healthchecks
- `GET /api/state`: devices, samples and events
- `POST /api/discover`: one SSDP pass, then an immediate poll
- `GET /api/art?host=<address>&uri=<cover>`: album art relay

The art relay exists because an https hub page cannot load a cover served by the speaker over plain
http, and a streaming service sometimes hands out a cover URL that only resolves locally. It only
accepts the cover URI the device itself reported on its last poll, so it is not an open proxy.

## Layout

```text
server/device.ts     device client: transport fallback, mDNS name resolution, parsing, art relay
server/discovery.ts  SSDP discovery, filtered on WiiM and LinkPlay descriptions
server/mdns.ts       dependency-free mDNS A record resolver
server/server.ts     polling loop, ring buffers, HTTP routes, static bundle, SPA fallback
src/                 React UI: components, settings and i18n provider, formatting helpers
src/locales/         en and fr dictionaries
scripts/build.sh     image build and push
```

The UI is React 19 + Vite + Tailwind CSS + shadcn/ui primitives (Radix), with lucide icons and a
self-hosted Inter variable font: one accent colour, a warm dark theme by default, a now-playing
view built around the album art, and a diagnostic view built around the numbers.

## Image publication

`scripts/build.sh` builds `linux/amd64` and pushes the version tag and `latest`:

```sh
./scripts/build.sh            # version from package.json
REGISTRY=ghcr.io/you ./scripts/build.sh 1.0.0
```

The GitHub workflow publishes on `v*` tags and manual dispatch, to both `ghcr.io` and the
configured private registry.

## Security

No authentication in v1. Keep the vhost on the LAN or a private mesh, and put an
authentication proxy in front of it before any public exposure, and before the control version
introduces write endpoints.

## License

MIT, see [LICENSE](LICENSE).
