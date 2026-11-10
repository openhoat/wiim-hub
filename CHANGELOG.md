# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are cut from `package.json`: the version in that file names the section below, and a
`v*` tag on the commit that bumps it publishes the image.

## [Unreleased]

## [0.9.14] - 2026-11-10

### Fixed

- A speaker that joins a group is now shown with the group it follows. Its own answer carries
  neither the group name nor its members, and its transport reads `mode 99, stop` because the
  stream runs on the speaker that drives the group; the hub joins the two answers it already
  polls, so a member card names the group, the speaker it follows, and the track that speaker is
  playing, labelled as the group's playback. The member's own fields are untouched, the copy lives
  in a separate `mirror`, and the report still prints what the device itself answered. The
  transport is not offered on such a card: a command sent to a member drives its own silent input,
  not the group. The "no sound" flow follows the same rule: it reads the group's transport instead
  of the member's own stopped one, and it stops asking a member for an output list it does not
  have.

## [0.9.13] - 2026-11-10

### Added

- The API can ask for a key: `WIIM_HUB_TOKEN` makes every `/api/*` route require either that key
  as a bearer or the identity a forward auth left on the request
  (`X-Auth-Request-Preferred-Username`, as oauth2-proxy writes it). A browser keeps its session and
  an agent stops needing one, which is what an MCP client could not have. The key is compared in
  constant time over hashed values, several comma separated values answer at once so a rotation
  needs no downtime, and a refusal is a `401` with `WWW-Authenticate: Bearer`. Unset, the hub keeps
  its old contract, the trust of the network it sits on: the static shell, the manifest, the worker
  and `/health` stay open either way.

## [0.9.12] - 2026-11-10

### Added

- The twelve diagnostic rules can post an alert: a JSON webhook in `NOTIFY_WEBHOOK` and an ntfy
  topic in `NOTIFY_NTFY` (with an optional `NOTIFY_NTFY_TOKEN`), both optional and independent. A
  rule that stays raised is one message and not one per poll, and a rule that clears and comes back
  inside `NOTIFY_QUIET_MS` (one hour by default) is held: a weak link flapping around its threshold
  is one fault. `NOTIFY_MIN_SEVERITY` leaves the four `info` rules out by default, `NOTIFY_RULES`
  narrows the channel to the rules named, and an unknown id is reported at start rather than
  silently ignored. A send is fire and forget with a five second budget, so a channel that is down
  is a log line, never a poll that waits or a channel that silences the other one. Nothing is
  retried and nothing is stored: a restart announces the open rules once, as a first start would.
- An MCP server beside the hub exposes the read and write surface to an agent: the fleet state, one
  diagnostic report, one settings sheet and one intent, over stdio. It is written as a client of the
  HTTP API rather than a route inside the hub, so `server/` keeps no dependency beyond node built-ins
  and the image is unchanged; the tool answers are the hub's own, errors included, and the security
  boundary is the network the two sit on, since neither authenticates anybody.

### Changed

- The page formats through the selected language, not the browser's: numbers go through
  `Intl.NumberFormat`, ages through `Intl.RelativeTimeFormat` (an outage older than a day reads
  "3 days ago" instead of "72 h ago"), and the two hand-written timestamp helpers that ignored the
  language setting are gone.
- Translations understand `{count, plural, one {# device} other {# devices}}`: English and French
  each pick their own branch, a count no longer carries an `(s)`, and French counts zero as
  singular, as it should. A plural can also carry the verb, so "1 crash counter is non zero" is a
  sentence the dictionary writes, not one the code assembles.
- A failed command and a failed settings write are one sentence with the device's answer inside it
  (`Command failed: {error}`), rather than two strings glued together at the call site.
- French copy pass: the update hint addresses the reader the way the rest of the page does, the hub
  "interroge" instead of "repolle", the crash counter is a "compteur de plantage" in both places that
  names it, and the ellipses are the typographic ones.

## [0.9.11] - 2026-11-10

### Added

- A name is resolved through a chain of sources instead of two fixed steps: the static pairs in
  `DEVICE_STATIC_HOSTS`, then the router's dnsmasq lease table in `DEVICE_LEASES_FILE` when the hub
  can read it, then the system resolver, then the built-in mDNS query. No single source covers a home
  network (a bridged container sees no multicast, a container is often blind to the host resolver)
  and the router that handed the address out already knows it. Each source is optional, so the chain
  degrades to what it can see.
- The diagnostic report names the source that answered a name:
  `Probe path: kitchen → 192.168.1.10, resolved by dhcp leases over https.` An address that came from
  the lease table says mDNS never answered, which is a different problem from an address mDNS got
  wrong.

### Changed

- Resolution timing is stated once and tested with an injected clock: an answer is kept for 30 s, a
  name that answered nothing is asked again after 60 s, two attempts are at least 5 s apart, and a
  device that stops answering drops the known answer so the next poll resolves again, while the
  failed attempt throttles the polls that follow. The last known address stays as the fallback. The
  lease table is read at most once a minute, matched by full hostname then by first label, and an
  expired lease is dropped.

## [0.9.10] - 2026-11-10

### Changed

- Internal only, no behaviour change: `server/device.ts` is now a directory, one module per area
  (`transport`, `resolve`, `payload`, `art`, `status`, `inputs`, `outputs`, `presets`, `acoustic`,
  `multiroom`, `diagnostics`, `settings`, `probes`), with `index.ts` keeping `DeviceState` and the
  two entry points. Each caller imports the module that owns its symbol instead of one 1200 line
  file, and the unit suite follows the same split.

### Added

- The hub stops asking a player for a command its firmware does not implement. An `unknown command`
  answer is remembered per address, firmware and command, so a model without an equalizer or a
  preset list costs one request per build instead of one per cache window; a firmware update changes
  the key and the probe is asked once again. The same answer seen on the write side was already
  read as a capability verdict rather than a transient failure.

## [0.9.9] - 2026-11-09

### Changed

- Internal only, no behaviour change: the visible height is read through an optional chain instead of
  a null test followed by a scale test, which is the one finding Sonar counted on the new code of
  0.9.8.

## [0.9.8] - 2026-11-09

### Fixed

- A sheet pinned to the bottom no longer disappears behind the on-screen keyboard on a phone. Chrome
  on Android keeps the layout viewport at full height and paints the keyboard over it, so the sheet
  stayed where it was and the form it held was entirely hidden; adding an address could not be
  finished. The document now asks for the content to be resized (`interactive-widget`), and
  `src/lib/viewport.ts` measures the gap for the engines that ignore the hint, publishing
  `--keyboard-inset` and `--visible-height`. A sheet sits above the keyboard and never grows past
  what is visible, so the field and its button stay on screen. The device sheet, which holds the
  name field, gets the same answer.

## [0.9.7] - 2026-11-09

### Changed

- Internal only, no behaviour change: the four findings the quality gate counted on new code were
  cleared. An unused `String.raw` tag on a streaming fixture, the last level of a tier read through
  its length instead of `at(-1)`, a set that discovery filled and emptied but never read, and a
  ternary nested inside another in the host dialog.

## [0.9.6] - 2026-11-09

### Added

- The cards keep the order the reader gave them. The hub answers its devices in the order it happens
  to hold them, which moves when a speaker joins or is rediscovered, so two cards swapped with no
  visible reason. The page now pins the first order it saw, appends a speaker it has never seen, and
  stores the whole thing in `localStorage` (`src/lib/layout.ts`). A pair of arrows in each card
  header moves it against its neighbour, and only that gesture changes the order; the diagnostic
  view reads the same one.
- Each diagnostic card folds to its header, remembered per address. The header keeps the name, the
  state and the export, the body is one click away.

### Fixed

- The device sheet no longer reloads itself while it is open. Its reader depended on the device
  object, which the poll rebuilds every three seconds, so the effect replayed and the field was
  rewritten with the value held by the speaker: a name took longer to type than one poll, so the
  save button could never be reached. The sheet reads once when it opens, and once after each write.
  A card is also keyed by address instead of name, so a speaker renaming itself does not remount the
  card and close the sheet under the hand.

## [0.9.5] - 2026-11-09

### Added

- A deployed hub now reaches the app installed from it, without a reinstall. The document was
  already served network first, so a launch picked the new bundle up; a window left open kept the
  one it loaded. A new service worker now waits instead of taking over, and the page offers a
  reload: the click activates it (`SKIP_WAITING`) and reloads once when it controls the page, so
  nothing is swapped under the pointer, and the view, the language and the last state survive. A
  check runs when the app returns to the foreground and every 30 min. A worker found waiting at
  startup is activated silently, since the page on screen already came from the network.

### Changed

- The web manifest and the icons are served network first, with the cached copy as a fallback. Served
  cache first, they answered the installed release's manifest to a browser asking about this one, so
  a changed name, colour or description never arrived. The manifest also carries `"id": "/"`, without
  which a changed `start_url` installs a second app instead of updating the first.

### Notes

- The icon of an app already installed on desktop Chrome still needs a reinstall: `icons` is not a
  field Chrome updates on desktop, and no site can change that
  ([manifest-updates](https://web.dev/articles/manifest-updates)). Android updates it with the rest
  of the manifest.

## [0.9.4] - 2026-11-09

### Added

- The diagnostic card states the streaming tier each service reaches on this model. A new panel
  reads `streamServicesCapability` when the card opens (five minute cache, never in the poll) and
  lists the services the firmware can drive with the top of the quality ladder it publishes for
  each one: `HI_RES` for Tidal, `UHD` for Prime, `FLAC 24 <= 192 kHz` for Qobuz (its format ids are
  translated), `FLAC 24 bit` for KKBOX. The full ladder sits in the row tooltip, the service playing
  comes first with an "in use" badge read from `getPlayerStatusEx.vendor`, and a dash says the
  firmware publishes nothing, which is the case for the cast endpoints the vendor app drives. No
  named tier is turned into a bitrate, and the 22 families that publish no level stay behind a
  count rather than being hidden.
- `GET /api/services?host=` answers that table as `{ts, host, services}`.

## [0.9.3] - 2026-11-09

### Fixed

- The web manifest is served as `application/manifest+json`, its media type, instead of
  `application/octet-stream`. Chrome read the file anyway, a stricter user agent would have taken it
  for a download.

## [0.9.2] - 2026-11-09

### Added

- The page opens without a network, and keeps what it last saw. A service worker caches the shell
  (the document, its bundle, the font and the icons) and never `/api/`: the live truth stays live,
  and its failures stay visible. When the hub stops answering, the cards keep the last state
  received, the banner dates it, and their clock stops at that moment so a seek bar does not advance
  on a position nobody measured. A first visit installs the whole shell, and each deploy replaces it
  while dropping the assets of the previous one.
- The host list is managed from the page. A server icon in the header opens the devices dialog: it
  lists every address the hub polls, says where each one came from, and writes the new list back to
  one JSON file on a volume (`HOSTS_FILE`, `data/hosts.json` next to the sources by default).
  `DEVICE_HOSTS` stays the operator's seed and cannot be edited from the page, a discovered host is
  kept by saving it, and a saved one can be repointed at another address or removed. Two rules keep
  the list honest: an address that resolves to a speaker already polled is refused with the entry it
  clashes with, and changing an address starts a new card, because the samples belonged to the old
  one and would follow the wrong machine. The demo serves the same dialog read only and says so
  instead of pretending to save.

## [0.9.1] - 2026-11-09

### Added

- The screenshots are on the documentation site, not only in the README. The home page opens on
  the interface itself: the now playing view sits right under the hero, full width, before any
  prose. Below it, the sound card, the diagnostic view and the same page on a phone; the
  how-it-works page shows the diagnostic view beside the findings it produces, and the demo page
  shows what the demo serves. The README keeps the captures it needs to make the point in ten
  seconds, and links to the site for the rest.

### Changed

- Every generated file now lands under `dist/`: the UI bundle in `dist/app`, the documentation site
  in `dist/docs` with its cache in `dist/docs-cache`, coverage in `dist/coverage`, the Playwright
  traces in `dist/playwright/results` and the Sonar workspace in `dist/sonar`. The repository root
  keeps its sources and no longer grows a directory per tool, and `npm run clean` removes all of
  them, plus the wireit cache and the generated `docs/public/logo.svg`, in one command.

### Fixed

- A streaming position reported in microseconds is read as milliseconds. `curpos` and `totlen`
  carry no unit: milliseconds on local and AirPlay sources, microseconds on some streaming
  firmwares, and the hub passed the raw value through. Measured values above ten hours are now
  read as microseconds, while the local sources keep their milliseconds so a file longer than ten
  hours still shows its real position, and the progress bar no longer runs to the end of a track
  on those sources.

## [0.9.0] - 2026-11-09

### Added

- The page installs as a web app. A manifest declares the name, the standalone display, the theme
  and background colours, and four icons: 192 px, 512 px, a maskable 512 px drawn inside the safe
  zone, and the SVG. Chrome and Edge now offer "Install" from the address bar, and the installed
  window carries the project's mark instead of a generated tile; iOS keeps using the
  `apple-touch-icon`. Until now the page had only a favicon, which is not an installable icon.
- A documentation site, built with VitePress from `docs/` and published to GitHub Pages by
  `.github/workflows/docs.yml`: a guide (quick start, configuration, devices, UPnP events, demo
  mode, development), a how-it-works page with Mermaid diagrams, and the API reference. The
  existing feature research and the two decision records are part of it, so the material that used
  to sit in the repository as files is now readable as a site.
- One mark, `docs/img/logo.svg`, drawn for the project: a green tile with three bars. It serves as
  the page favicon, the app icon on a phone home screen (`public/apple-touch-icon.png`), the README
  header and the site logo, so the project is recognisable at 16 px as it is in a tab.
- `docs:dev`, `docs:build` and `docs:logo` tasks: the site builds locally the way the pipeline
  builds it, and the two copies of the mark are produced from the source rather than redrawn.
- The page declares two `theme-color` values, one per colour scheme, so a phone paints its browser
  chrome in the page's own background instead of a default white or black.
- The event hub is now tested against a player that breaks: it drops the subscription in the
  middle of it, refuses to renew one, sends a notification without a `SID`, and sends one larger
  than the listener buffers. Coverage of `server/upnp.ts` goes from 92.8 % to 99.1 % of its lines,
  and the listener's `close` is checked to be idempotent.
- `server/guides.test.ts` pins the wording of every verdict the four flows can emit, one case per
  identifier, so a sentence cannot drift from the row it explains.
- The README carries a static `sonar ratings` badge (`docs/img/sonar-ratings.svg`), and
  `CONTRIBUTING.md` says how it is kept: the scan runs where the instance is reachable, never in the
  pipeline, and the badge is updated by hand when the ratings change.

### Changed

- The support report quotes a verdict, not a pass: a flow with nothing to report now says so in one
  sentence instead of quoting the row that settled it. The page is untouched, it keeps every
  sentence in both languages.
- The view switch is a `fieldset` with a visually hidden legend: the same segmented control, with
  the native element for a group of related buttons instead of a `div` carrying `role="group"`.
- The play-URL field no longer sets `autoFocus`: the dialog already moves the focus to its first
  field when it opens, so the attribute only repeated it.
- Sonar reads clean: 62 open issues to none, with the four ratings at A. The write vocabulary is a
  table of one parser per action (`server/commands.ts`), the three route chains are a route table
  plus one handler per endpoint (`server.ts`, `demo.ts`), and the device readings are one function
  per area, which removed the cognitive-complexity findings rather than suppressing them. Three
  findings are recorded in Sonar instead: the two multicast group addresses (protocol constants,
  not configuration) and the per-device drain loop, whose `await` is the serialisation.

## [0.8.1] - 2026-11-09

### Fixed

- The guided-flow end-to-end test no longer pins a signal value the demo drifts on every tick
  (the RSSI walks a couple of dBm around -52): it asserts the sentence's shape, so the suite stops
  failing on a render that landed between two samples.

## [0.8.0] - 2026-11-09

### Added

- The device parsers are pinned by tests against the answers a real player sent:
  `server/fixtures/wiim-pro.ts` keeps those answers verbatim (sanitised), and
  `server/device.test.ts` runs them through the pure seams `parseDevice`, `parseCapability`,
  `parsePresets`, `parseAcoustic` and `parseRegistry` — hex titles, `unknown command`, empty
  bodies, numeric counters, the `unknow` placeholders, an external input with no position, a live
  stream with no duration, and an unmapped playback mode that must light up no input.
- The optimistic reconciliation left the hook: `src/lib/optimistic.ts` holds what a click paints
  and how long it survives, and `src/lib/optimistic.test.ts` covers it without a browser. The unit
  suite now spans `src/**/*.test.ts` as well as `server/**/*.test.ts`.
- The support report carries a capability inventory: `server/inventory.ts` asks the eighteen
  commands the hub depends on (`getStatusEx` … `getShutdown`), classifies each answer as
  `supported`, `unsupported` (`unknown command`), `failed` (`Failed`, an HTTP answer that refuses),
  `empty` or `unreachable`, and prints the command, the area, the status and the first 160
  characters of the body, followed by the counts. The probe path (`host` → address → scheme that
  answered) rides the same section, and `/api/report` returns `inventory` and `resolution` next to
  the Markdown. An offline player is not probed: eighteen timeouts would say nothing the offline
  finding does not already say, so the section states that the probe was skipped.
- The four guided checks answer the questions a user arrives with ("no sound", "it drops", "wrong
  output", "cannot join a group"). `server/guides.ts` reads the device in a fixed order and stops at
  the first check that is not a pass, so the last row is the first anomaly: mute, volume, sleep
  timer, source, transport, output for "no sound"; link then network and crash counters for "it
  drops"; the active route for "wrong output"; the group protocol version, role and link for
  "cannot join a group". The source is read before the transport so an external input with no signal
  is named instead of reading as "the transport is stopped". A check the device could not answer
  stops the flow without counting as a pass (`settled: false`), and every row names the field it read.
  `guides` rides `/api/state`, the page shows the flows as tabs under the findings, and the report
  gains a `## Guided checks` section between the findings and the capability inventory.

### Fixed

- The album and the artist fall back to the player's own hex fields when `getMetaInfo` answers
  nothing, as the title already did: a failed metadata read used to blank two thirds of the track.
- A failed `multiroom:getnamegrouplist` probe no longer erases the saved group from the panel for a
  minute; the other cached probes already kept the last good answer.

## [0.7.0] - 2026-11-09

### Added

- Diagnostic findings: the diagnostic view now reads the device's own counters (`getNetworkHealth`,
  `getDebugInfo`, `getHwErrorInfo`, refreshed every 60 s in three parallel commands) and turns them
  into a short list of facts, each with the number that supports it and the command it came from.
  Twelve rules: offline, weak link, Wi-Fi and wired drops, ping failures, abnormal reboots, crash
  counters, lost UPnP actions, flash wear, hardware faults, a degraded push channel, a running
  sleep timer. A clean device says "no anomaly detected" and lists what was read.
  `parseDiagnostics` is a pure seam, tested against the payloads the reference player really sends
  (the counters arrive as numbers where `getStatusEx` answers strings).
- `GET /api/report?host=` renders the same findings as an English Markdown report with the raw
  answers appended; the page copies or downloads it, and the two actions are covered by the demo
  and its end-to-end test.
- `HUB_VERSION` names the version in the report: the runtime image carries no `package.json`.

### Fixed

- A callback port already in use is reported instead of leaving the hub silently on the fast poll
  with no explanation of why the subscriptions never appear.

## [0.6.0] - 2026-11-09

### Added

- UPnP event subscriptions, opt-in: with `UPNP_CALLBACK` naming an address the speakers can reach,
  the hub subscribes on port 49152, renews on the same SID and receives the volume, the mute, the
  transport state, the track metadata and the duration as the player emits them. Measured on the
  reference player, a volume write reaches the page in under half a second instead of waiting for
  the next poll, and the poll relaxes to `SLOW_POLL_MS` for the fields nobody events (position,
  counters, group, inputs, equalizer): about five times fewer requests per minute.
- The diagnostic card shows the push state (`subscribed`, `polling only`, `polling fallback`) with
  the age of the last event, so a silent channel is not mistaken for a device nobody touches.

### Changed

- The poll loop reschedules itself: the interval follows the subscriptions instead of being fixed.
- A subscription that fails its renewal, or that two polls contradict, is declared degraded and the
  hub drops back to the fast poll; the entry is kept so the page can say why.

## [0.5.1] - 2026-11-09

### Fixed

- An external input (optical, line in) is no longer rendered as a broken player. The firmware keeps
  answering the position and the duration of the last stream it played while the input has no track,
  which showed a moving seek bar under "nothing playing"; the hub now nulls that position for those
  inputs, keeps the real transport state and prints the name of the source instead.

### Changed

- The README opens on a notice: the hub is an independent, community project, not affiliated with
  or endorsed by WiiM or LinkPlay Technology, and it ships no vendor code.
- TypeScript 7 (`7.0.2`): the `baseUrl` option is gone, so the `@/*` paths now resolve from the
  configuration directory, and the stylesheet side-effect import is typed by the Vite client
  declarations (`src/vite-env.d.ts`). `@types/node` follows, at 26.

## [0.5.0] - 2026-11-09

### Added

- Demo mode (`npm run demo`): the real interface over two simulated speakers, one playing and one
  offline with a saved group, with generated covers, a seeded signal history and writes that mutate
  the state the page renders. It needs no device and no extra dependency, and every simulated state
  is typed as the device state the hub renders, so a change in the polling code breaks it at compile
  time.
- End-to-end suite (`npm run test:e2e`): Playwright drives that demo in Chromium, covering the
  cards, the group panel, the sound card, the diagnostic view and its CSV export, a volume write
  that survives a poll, the persisted view, language and theme, and the phone layout. The CI
  workflow runs it on every push, so the suite needs no real player.
- Continuous integration: type check and build on every push and pull request, on Node 22.18 and
  24 (`.github/workflows/ci.yml`).
- Quality gate (`npm run validate`): biome for lint and format, markdownlint and prettier on the
  Markdown, the unit suite with its coverage thresholds, the type check and the build, wired as a
  wireit task graph that CI caches. `npm run qa:fix` rewrites the formatting.
- Unit suite (`npm run test:coverage`, vitest): the intents the hub accepts, the commands it builds
  from the state, and the per-device write queue now extracted to `server/queue.ts`, so its
  ordering and coalescing are tested without a speaker.
- Contributor material: `CONTRIBUTING.md`, `SECURITY.md` and `GLOSSARY.md`, plus architecture
  decision records in `docs/adr/` (zero runtime dependencies, the demo mode as the e2e substrate).
- Repository automation: weekly Dependabot updates for npm and the actions, a tag-driven GitHub
  release that reads the notes from this changelog, and commitlint behind a Husky hook.
- SonarQube scan (`npm run sonar`, `sonar-project.properties`): sources, tests, coverage from the
  vitest report; the instance URL and the token come from the environment, never from the
  repository.
- This changelog.

### Changed

- The README screenshots are captures of the demo mode instead of a real fleet: simulated
  speakers, invented titles, generated covers and documentation addresses.
- The release workflow publishes to `ghcr.io` only; the private registry it also pushed to is
  gone, along with its secrets.
- `scripts/build.sh` defaults to the published image namespace.
- Device, group and member names, addresses and uuids quoted in the documentation are anonymised;
  the payload shapes and the firmware wording are unchanged.
- The CI validate job runs `npm run validate` behind the wireit cache instead of running the type
  check and the build as separate steps.

## [0.4.3] - 2026-11-09

### Added

- Multiroom, read only: the role a speaker claims (`master`, `member` or `none`) from
  `multiroom:getSlaveList`, the group name and its members from `multiroom:getnamegrouplist`, a
  group chip on the now playing card and a member panel. A saved group that is not running says
  so, and a member with no address reports an unknown state rather than a fake offline one.

### Fixed

- The card showed the device's own name as a group name: `GroupName` carries the speaker name on
  this firmware, so the group name comes from the registry only.

### Changed

- `start` and `start:server` read `.env` through `--env-file-if-exists`, so the device list lives in
  one file instead of a shell export; a variable already set in the environment still wins.

## [0.4.2] - 2026-11-08

### Security

- The album art relay is confined to the device and to public image hosts: the target name is
  resolved once and the connection goes to the address that was checked, a private, loopback,
  link-local, carrier NAT or multicast address is refused except the speaker's own, the type comes
  from the first bytes rather than from the response headers, the transfer stops at 6 MiB and 5 s,
  and every refusal is logged with its reason.

## [0.4.1] - 2026-11-08

### Changed

- The sound card stays folded until it is opened; the quality chip remains in the header.

## [0.4.0] - 2026-11-08

### Added

- Graphic equalizer: the curve is read per source, edited one band at a time, with the 24 factory
  curves, and room correction reported as a read-only capability.
- Stream quality: sample rate, bit depth and bit rate from `getMetaInfo`, shown as one chip.
- Device settings sheet: name, status LED, touch controls, balance, maximum volume and fade, read
  when the sheet opens and written on an explicit gesture.
- Stream URL: the speaker fetches the URL itself (`setPlayerCmd:play`), with the stream numbers
  read back from the stream.
- One card per speaker, with its own state, samples, events and write queue.

## [0.3.0] - 2026-11-08

### Added

- Controls on the now playing card: play and pause, previous, next, stop, seek, volume and mute,
  source switching, saved presets, sleep timer and audio output routing.
- An intent based write surface: the browser sends an action, the server validates it against the
  state it holds (volume ceiling, available inputs and outputs) and maps it to the device command.
- One writer per device, with last value coalescing for volume and seek, and an immediate re-read
  so an optimistic value is confirmed or dropped within a few hundred milliseconds.

### Fixed

- The image did not copy `public/`, so the favicon answered 404 since 0.2.1.

## [0.2.1] - 2026-11-08

### Fixed

- The page ships the favicon link; `.scratch/` is ignored.

## [0.2.0] - 2026-11-08

### Added

- Album art relayed by the hub, because an https page cannot load the speaker's plain http cover;
  the route only accepts the cover the device reported on its last poll.
- A multi-stage image: Vite builds the bundle, the runtime carries the server and `dist` only.

### Changed

- The interface is rebuilt on React 19, Vite, Tailwind CSS v4 and shadcn/ui primitives, with a warm
  dark theme by default and one green accent.
- Now playing view centred on the album art, diagnostic view on the numbers; the chosen view,
  language and theme persist per browser.
- Fixed dBm window for the RSSI sparkline, so a flat line means a steady signal, with the
  weak-signal threshold drawn in.
- Toast, dropdown, skeleton and empty states, an icon-only view switch on narrow screens, and an
  `aria-live` summary of playback.

## [0.1.0] - 2026-11-08

### Added

- Read-only hub for LinkPlay based WiiM devices: per-device polling with https/443 to http/80
  transport fallback, name resolution by mDNS with the last known address retained, and SSDP
  discovery as a best-effort complement to an explicit device list.
- A now playing view and a diagnostic view over the same data, RSSI history, an event log, a
  sample table, JSON and CSV export.
- English and French labels, picked from the browser, with an English fallback.

[Unreleased]: https://github.com/openhoat/wiim-hub/compare/v0.9.11...HEAD
[0.9.14]: https://github.com/openhoat/wiim-hub/compare/v0.9.13...v0.9.14
[0.9.13]: https://github.com/openhoat/wiim-hub/compare/v0.9.12...v0.9.13
[0.9.12]: https://github.com/openhoat/wiim-hub/compare/v0.9.11...v0.9.12
[0.9.11]: https://github.com/openhoat/wiim-hub/compare/v0.9.10...v0.9.11
[0.9.10]: https://github.com/openhoat/wiim-hub/compare/v0.9.9...v0.9.10
[0.9.9]: https://github.com/openhoat/wiim-hub/compare/v0.9.8...v0.9.9
[0.9.8]: https://github.com/openhoat/wiim-hub/compare/v0.9.7...v0.9.8
[0.9.7]: https://github.com/openhoat/wiim-hub/compare/v0.9.6...v0.9.7
[0.9.6]: https://github.com/openhoat/wiim-hub/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/openhoat/wiim-hub/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/openhoat/wiim-hub/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/openhoat/wiim-hub/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/openhoat/wiim-hub/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/openhoat/wiim-hub/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/openhoat/wiim-hub/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/openhoat/wiim-hub/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/openhoat/wiim-hub/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/openhoat/wiim-hub/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/openhoat/wiim-hub/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/openhoat/wiim-hub/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/openhoat/wiim-hub/compare/v0.4.3...v0.5.0
[0.4.3]: https://github.com/openhoat/wiim-hub/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/openhoat/wiim-hub/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/openhoat/wiim-hub/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/openhoat/wiim-hub/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/openhoat/wiim-hub/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/openhoat/wiim-hub/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/openhoat/wiim-hub/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/openhoat/wiim-hub/releases/tag/v0.1.0
