# WiiM Hub

Hub for WiiM devices (and other LinkPlay-based players) on a local network: what each device is
playing, what it reports about itself, and the controls you need when the vendor app is not at
hand. Devices are polled every few seconds and served as a small web page.

A local, self-hosted complement to the vendor app: the same device data, on a screen you already
have open, with an interface that fits a browser and a phone. Every device gets its own card,
state and write queue, so a mixed fleet (Pro, Mini, Amp, Ultra, and OEM LinkPlay players) is the
normal case, not a special one. Multiroom is a roadmap item, not a promise.

## Why a second view

The router sees an association; the device reports what it thinks it is: its own signal reading,
the SSID it joined, the BSSID it landed on, what it is playing. When a unit misbehaves, the two
views diverge, and the device side is the one the official app consumes.

## Features

- Several devices side by side, polled in parallel, in the order of their names. A device seen
  twice (configured as `salon.local`, discovered as `192.168.1.150`) is kept once.
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
- **Controls** on the now playing card: play and pause, previous, next, stop, seek, volume and
  mute, source switching, saved presets, sleep timer, audio output route, and a stream URL the
  speaker fetches itself. Every control paints the expected value immediately and lets the next
  poll confirm or revert it, and the hub serialises one write per device so a slider drag cannot
  race itself.
- **Sound card**: the graphic equalizer read per source and edited one band at a time, the 24
  factory curves, the stream quality the player reports (sample rate, bit depth, bit rate), and
  room correction as a capability, read-only until its write payload is proven.
- **Device settings sheet**: name, status LED, touch controls, balance, maximum volume and fade,
  read when the sheet opens and written on an explicit gesture. The hub keeps no copy.
- **One writer per device**: volume and seek writes are coalesced to their last value, everything
  else is queued in order. The device is a small embedded server, not a database.
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
- Writes are `GET` requests too, and answer `OK`, a JSON body, `Failed` or `unknown command`. The
  last one is a capability answer, not a transient failure: the control is then shown as
  unsupported instead of retried.
- `setPlayerCmd:seek:<n>` takes **seconds** while `curpos` comes back in milliseconds.
  `MCUKeyShortClick` answers `OK` even for an empty preset slot, so presets are read from
  `getPresetInfo`, never inferred from the write.
- The graphic equalizer is stored **per source**. `EQGetLV2SourceBandEx` with an empty
  `source_name` answers the curve of the source playing and names it; `EQSetLV2SourceBand` targets
  that source, keeps the other bands, and **drops the factory name** as soon as one band moves.
  `EQLoad:<name>` answers the whole new curve. Measured gain range: -12..+12 dB.
- `setPlayerCmd:play:<url>` switches the player to its own push mode (`CustomPushUrl`): the
  address becomes the title, and the stream numbers come from the stream itself.
- Device settings are one command each: `setDeviceName:<name>` (a space survives the query
  encoding), `LED_SWITCH_SET`, `Button_Enable_SET`, `SetFadeFeature`, `setMaxVolume`, and
  `setChannelBalance`, which accepts -1..1 and answers `Failed` beyond.
- Switching input with `setPlayerCmd:switchmode` can leave the device stopped: after a source
  change the hub re-reads instead of assuming playback continued.
- No CORS header: a browser cannot call the device directly, hence this hub.
- Album art arrives as an absolute URL (sometimes an external streaming host): the hub fetches it,
  the browser never talks to the speaker or to the streaming CDN.

The endpoints live under `/httpapi.asp?command=<name>`; the family is documented by the
community, not by the vendor, so the client is defensive by design.

## Run with Docker

```sh
docker build -t wiim-hub .
docker run --rm -p 8090:8090 -e DEVICE_HOSTS=192.168.1.10,salon.local,kitchen wiim-hub
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
| `DEVICE_HOSTS` | empty   | Comma separated device addresses or names, authoritative list; one entry per speaker |
| `DISCOVERY`    | `1`     | SSDP discovery, best effort, set `0` to disable          |

## Endpoints

- `GET /health`: liveness, for container healthchecks
- `GET /api/state`: devices, samples and events
- `GET /api/settings?host=<address>`: name, LED, touch controls, balance, maximum volume and fade,
  read live when the settings sheet opens
- `POST /api/command?host=<address>`: one intent (`{"action":"volume","level":30}`), validated
  against the device state and written through the per-device queue
- `POST /api/discover`: one SSDP pass, then an immediate poll
- `GET /api/art?host=<address>&uri=<cover>`: album art and preset art relay

The command route accepts an intent, never a raw device command. The server owns the mapping:
it bounds the volume by the device's `max_volume`, refuses an input or an output the device does
not report, and answers with the device body so the UI can show it. That keeps the write surface
closed to anything the page did not anticipate.

The art relay exists because an https hub page cannot load a cover served by the speaker over plain
http, and a streaming service sometimes hands out a cover URL that only resolves locally. It only
accepts a cover URI the device itself reported on its last poll, track or preset, so it is not an
open proxy.

## Layout

```text
server/device.ts     device client: transport fallback, mDNS name resolution, parsing, art relay
server/commands.ts   accepted intents, validation against the device state, command mapping
server/discovery.ts  SSDP discovery, filtered on WiiM and LinkPlay descriptions
server/mdns.ts       dependency-free mDNS A record resolver
server/server.ts     polling loop, write queue, ring buffers, HTTP routes, static bundle, SPA fallback
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

The hub has no built-in authentication, by design: identity belongs to the ingress. Run it on a
private network, or behind a forward-auth proxy such as oauth2-proxy or Authelia, and keep
`/health` reachable without a session if a probe needs it. The control version writes to the
device, so exposing it without an authentication layer is not supported.

## Roadmap

- [`KANBAN.md`](KANBAN.md): the board, with priorities and the current item.
- [`docs/feature-research.md`](docs/feature-research.md): what the LinkPlay API exposes, what was
  measured on a real player, and the behaviour requirements for the control, diagnostic and
  multiroom versions.

## License

MIT, see [LICENSE](LICENSE).
