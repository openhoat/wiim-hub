# Kanban

Board conventions follow the `task-format` rule: stable `#N` numbers, `[CATEGORY]` plus optional
`(P1|P2|P3)` in the Backlog, `[TAG]` in In Progress, and no Done column (git history is the
record). An item moved to In Progress keeps its number and gains a start timestamp.

Detailed requirements live in `docs/feature-research.md`; cards stay coarse and point there.
Fine grained work in progress goes to the gitignored `.scratch/<slug>/` directory, never here.

## In Progress

Nothing in progress: 0.4.0 shipped the equalizer, the stream quality, the device settings and the
stream URL (#15, #17, #18 closed; see git history).

## Backlog

### #2 [UX] Add the diagnostic assistant with findings and report export (P1)

- [ ] Derive findings from the link, health, hardware and playback signals, each with its evidence
- [ ] Add the deterministic guided flows: no sound, drops, wrong output, cannot join a group
- [ ] Export one JSON report plus a Markdown summary, and copy it from the UI
- [ ] Say "no anomaly detected" when nothing is wrong, with the values that support it

### #3 [SECURITY] Constrain the cover art relay to URLs the device reported (P1)

- [ ] Reject any `uri` that was not seen in a device payload, and cap size, type and timeouts
- [ ] Block private ranges other than the configured device hosts, and log refusals

### #4 [UX] Add a multiroom group view with per member control (P2)

[//]: # Blocked: the member payload of `multiroom:getSlaveList` and the join/leave/kick semantics cannot be measured while only one speaker is reachable (the Mini is in RMA). Reads can ship first; the writes wait for a second unit.

- [ ] Read the role from `multiroom:getSlaveList` and render master, members and orphans
- [ ] Per member volume and mute with coalescing, plus one synchronised volume control
- [ ] Join, leave and kick out with a confirmation naming the device and the raw answer on failure
- [ ] Reconcile the group state after every write instead of trusting the optimistic view

### #5 [PERFORMANCE] Replace polling with UPnP event subscriptions (P2)

- [ ] Subscribe to the device events on port 49152, renew the subscription, keep polling as a fallback
- [ ] Detect a stale subscription and fall back within one poll interval
- [ ] Measure the effect on request count and on UI latency, and record both in the docs

### #7 [UX] Manage devices from the UI (P2)

- [ ] Add, rename and remove hosts, persisted server side, with the source of each entry shown
- [ ] Distinguish a configured host, a discovered host and an offline host in one list

### #8 [TEST] Cover the device client and the write queue (P2)

- [ ] Unit test the parsing of the awkward payload shapes, including `unknown command` and empty bodies
- [ ] Test the queue, coalescing, optimistic reconciliation and the position unit heuristic
- [ ] Add a recorded fixture per endpoint so the tests do not need a real player

### #9 [DEVOPS] Add a CI workflow for the repository (P2)

- [ ] Run the type check and the build on push, and publish the image on tags
- [ ] Keep the compose example and the README instructions in sync with the published image

### #16 [UX] Explain which tier each streaming service can reach (P3)

- [x] Display the sample rate, bit depth and bit rate from `getMetaInfo` as one chip (0.4.0)
- [ ] Read `streamServicesCapability` and explain which tier a service can reach on this model

### #10 [UX] Add a PWA shell with install and offline support (P3)

- [ ] Add a manifest, icons and a service worker caching the shell only, never the API
- [ ] Show the last known state with its age when the hub is unreachable

### #11 [UX] Add notifications and webhooks for the alerts (P3)

- [ ] Support a generic webhook and ntfy, with a per alert rule and a quiet period
- [ ] Never send a notification twice for the same event, and log what was sent

### #12 [ARCHITECTURE] Split the device module by capability and cache the capability probes (P3)

- [ ] One module per area: status, playback, inputs, outputs, acoustic, multiroom
- [ ] Cache the `unknown command` answers per firmware so a page never re-probes a missing feature

### #13 [ARCHITECTURE] Make name resolution pluggable (P3)

- [ ] Keep mDNS, the last known address and a static map as interchangeable resolvers
- [ ] Add an optional DHCP lease source for networks where mDNS does not cross the container boundary

### #14 [I18N] Complete the French copy and localise the formats (P3)

- [ ] Review every string in context, including the diagnostic findings and the guided flows
- [ ] Localise numbers, dates and durations through `Intl`, with no concatenated sentences
