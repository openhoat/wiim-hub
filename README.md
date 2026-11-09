# WiiM Hub

[![CI](https://github.com/openhoat/wiim-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/openhoat/wiim-hub/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.18-informational.svg)](package.json)

Hub for WiiM devices (and other LinkPlay-based players) on a local network: what each device is
playing, what it reports about itself, and the controls you need when the vendor app is not at
hand. Devices are polled every few seconds and served as a small web page.

A local, self-hosted complement to the vendor app: the same device data, on a screen you already
have open, with an interface that fits a browser and a phone. Every device gets its own card,
state and write queue, so a mixed fleet (Pro, Mini, Amp, Ultra, and OEM LinkPlay players) is the
normal case, not a special one. Multiroom is read only for now: the hub shows the group a speaker
belongs to, and its controls arrive once a second unit can be measured.

## Screenshots

Now playing, with the control panel, one speaker online and one offline:

![Now playing](docs/img/now-playing.jpeg)

The sound card, with the per-source equalizer, and the diagnostic view:

| | |
| --- | --- |
| ![Sound card](docs/img/sound.jpeg) | ![Diagnostic view](docs/img/diagnostics.jpeg) |

The same pages on a phone:

<p align="center"><img src="docs/img/mobile.jpeg" width="320" alt="Now playing on a phone"></p>

Device addresses and Wi-Fi identifiers are redacted in these captures.

## Why a second view

The router sees an association; the device reports what it thinks it is: its own signal reading,
the SSID it joined, the BSSID it landed on, what it is playing. When a unit misbehaves, the two
views diverge, and the device side is the one the official app consumes.

## Features

- Several devices side by side, polled in parallel, in the order of their names. A device seen
  twice (configured as `kitchen.local`, discovered as `192.168.1.10`) is kept once.
- Per-device transport: https/443 first, http/80 fallback remembered, so a mixed firmware fleet
  costs at most one extra request per device.
- Devices configured by address or by name (`kitchen.local`): the built-in mDNS resolver (system
  resolver first, then a dependency-free multicast query) keeps a DHCP lease change invisible, and
  the last known address is retained when a re-resolution fails.
- SSDP discovery as a best-effort complement to an explicit device list.
- **Two views on the same data**: a *now playing* view for everyday use (art, track, progress,
  playback state, volume, multiroom chip, offline badge) and a *diagnostic* view for support (raw
  fields, RSSI sparkline, event log, sample table, CSV export). The selected view is remembered
  per browser.
- Now playing: track, artist, album, album art (relayed by the hub, see below), playback progress
  extrapolated between polls, playback source badge, playback state, volume.
- **Controls** on the now playing card: play and pause, previous, next, stop, seek, volume and
  mute, source switching, saved presets, sleep timer, audio output route, and a stream URL the
  speaker fetches itself. Every control paints the expected value immediately and lets the next
  poll confirm or revert it, and the hub serialises one write per device so a slider drag cannot
  race itself.
- **Multiroom, read only**: the role the speaker claims (master, member or none), the group name and
  its members, from `multiroom:getSlaveList` and `multiroom:getnamegrouplist`. A saved group that is
  not running says so, and a member with no address reports an unknown state instead of a fake
  offline one. No write control is rendered until a second unit can be measured.
- **Sound card**, folded until opened: the quality chip stays in the header, the graphic equalizer
  is read per source and edited one band at a time, with the 24 factory curves and room correction
  as a capability, read-only until its write payload is proven.
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

The published image is `ghcr.io/openhoat/wiim-hub` (`linux/amd64`):

```sh
docker run --rm -p 8090:8090 -e DEVICE_HOSTS=192.168.1.10,living-room.local,kitchen ghcr.io/openhoat/wiim-hub:latest
```

To build it yourself instead:

```sh
docker build -t wiim-hub .
docker run --rm -p 8090:8090 -e DEVICE_HOSTS=192.168.1.10,living-room.local,kitchen wiim-hub
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
cp .env.example .env                           # one file, read by the server on start
npm run build                                  # writes dist/
npm start                                      # server + built UI on :8090
```

`start` and `start:server` read `.env` through `--env-file-if-exists`, so the device list lives in
one file instead of a shell export. A variable already set in the environment wins over the file,
and a missing file is not an error: the defaults from the table below apply. `.env` is ignored by
git; `.env.example` is the template.

For UI work, run the two processes side by side: `npm run start:server` (API on :8090, also reads
`.env`, restarts on change) and `npm run start:dev` (Vite on :5173, proxies `/api` and `/health` to
the API). `start:dev` is the UI only: it never starts the API, so a stale API on :8090 keeps
answering the Vite proxy until you restart it. When the cards do not match the file, that is the
first thing to check.

Then open <http://localhost:8090>, or <http://localhost:5173> in development.

## Configuration

The server reads `.env` from the working directory when it exists (`start` and `start:server`);
inside Docker the variables come from the compose file instead.

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
open proxy. Beyond that check:

- the target name is resolved once, and the connection goes to the address that was checked, so a
  name cannot answer a public address during the check and a private one at connect time;
- a private, loopback, link-local, carrier NAT or multicast address is refused, with one exception:
  the speaker's own address, which is the one device the hub already polls. A cover hosted by
  another machine on the local network is refused rather than fetched;
- the body decides the type: JPEG, PNG, GIF and WebP are recognised from their first bytes, and a
  text or HTML answer is refused even when the response claims to be an image;
- the transfer stops at 6 MiB and 5 s, and every refusal is logged with its reason.

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

[`.github/workflows/docker.yml`](.github/workflows/docker.yml) builds and pushes on every `v*` tag
and on manual dispatch, to `ghcr.io/<owner>/<repo>`, with version, major.minor and short sha tags,
`linux/amd64` only.

The same thing locally, through `scripts/build.sh`:

```sh
./scripts/build.sh                                  # version from package.json
REGISTRY=registry.example IMAGE=my-hub ./scripts/build.sh 1.0.0
```

## Security

The hub has no built-in authentication, by design: identity belongs to the ingress. Run it on a
private network, or behind a forward-auth proxy such as oauth2-proxy or Authelia, and keep
`/health` reachable without a session if a probe needs it. The control version writes to the
device, so exposing it without an authentication layer is not supported.

## Roadmap

- [`CHANGELOG.md`](CHANGELOG.md): what changed in each version.
- [`KANBAN.md`](KANBAN.md): the board, with priorities and the current item.
- [`docs/feature-research.md`](docs/feature-research.md): what the LinkPlay API exposes, what was
  measured on a real player, and the behaviour requirements for the control, diagnostic and
  multiroom versions.

## License

MIT, see [LICENSE](LICENSE).
