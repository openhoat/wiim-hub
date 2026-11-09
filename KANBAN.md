# Kanban

Board conventions follow the `task-format` rule: stable `#N` numbers, `[CATEGORY]` plus optional
`(P1|P2|P3)` in the Backlog, `[TAG]` in In Progress, and no Done column (git history is the
record). An item moved to In Progress keeps its number and gains a start timestamp.

Detailed requirements live in `docs/feature-research.md`; cards stay coarse and point there.
Fine grained work in progress goes to the gitignored `.scratch/<slug>/` directory, never here.

## In Progress

### #2 [UX] Add the diagnostic assistant with findings and report export (P1) — started 2026-11-09

Findings and the report shipped (`server/findings.ts`, `GET /api/report`); the guided flows below
are what remains on the card.

- [x] Derive findings from the link, health, hardware and playback signals, each with its evidence
- [x] Export one JSON report plus a Markdown summary, and copy it from the UI (the report is served
      by `/api/report` and carries the raw answers; the capability inventory is still missing)
- [x] Say "no anomaly detected" when nothing is wrong, with the values that support it
- [ ] Add the deterministic guided flows: no sound, drops, wrong output, cannot join a group

Card #4 keeps its write half blocked on a second reachable unit.

## Backlog

### #4 [UX] Add a multiroom group view with per member control (P2)

[//]: # Blocked on a second reachable unit: the member payload of `multiroom:getSlaveList` (with members) and the join/leave/kick semantics cannot be measured while only one speaker answers. The read side shipped in 0.4.3; the writes wait.

- [x] Read the role from `multiroom:getSlaveList` and render master, members and orphans
- [ ] Per member volume and mute with coalescing, plus one synchronised volume control
- [ ] Join, leave and kick out with a confirmation naming the device and the raw answer on failure
- [ ] Reconcile the group state after every write instead of trusting the optimistic view

### #7 [UX] Manage devices from the UI (P2)

- [ ] Add, rename and remove hosts, persisted server side, with the source of each entry shown
- [ ] Distinguish a configured host, a discovered host and an offline host in one list

### #8 [TEST] Cover the device client and the write queue (P2)

- [x] Test the write queue and its coalescing by family (`server/queue.test.ts`, quality pass)
- [ ] Unit test the parsing of the awkward payload shapes the device client reads, including `unknown command` and empty bodies
- [ ] Test the optimistic reconciliation and the position unit heuristic (milliseconds locally, microseconds on the streaming services)
- [ ] Add a recorded fixture per endpoint for those tests: the interface side already runs without a player (`npm run demo` and `e2e/`), the device client side does not

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

### #19 [ARCHITECTURE] Expose the hub over MCP (P3)

- [ ] Mirror the HTTP surface as tools: reads on `/api/state` and `/api/settings`, writes on
      `/api/command` with the same intent validation and the same error answers
- [ ] Pick the shape before coding: a sidecar over the hub HTTP API keeps `server/` dependency
      free, an endpoint inside the hub process avoids a second deployment
- [ ] Develop and test the tools against the demo mode, as the e2e suite does, and state the
      security boundary: no authentication of its own, it inherits the ingress
