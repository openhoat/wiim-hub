# 0002 — The demo mode drives the end-to-end suite and the screenshots

- Status: accepted
- Date: 2026-11-09

## Context

The interface only shows its value against a speaker that plays something, drops out, remembers a
group or refuses a write. A public repository and a CI runner have no speaker, no LAN and no
credentials, and a suite that needs hardware rots between the moments somebody runs it. A suite
replaying recorded payloads would test a snapshot of the answers, not the behaviour of the page.

## Decision

`server/demo.ts` serves the real UI bundle with three simulated speakers (a running group of two
players, and one offline speaker with a saved group), in memory, with no extra dependency. Its states are typed as the `DeviceState`
the hub renders, its writes go through the same `parseAction` and `commandFor` as the real server,
and they mutate the state the page reads back on the next poll. Playwright drives it on port 8091
(`e2e/`), in CI too. The README screenshots come from it.

## Consequences

- The demo cannot drift silently: a change in a polled field breaks it at compile time.
- The end-to-end suite verifies the HTTP contract and the interface, not the awkward payload shapes
  of the device API. Those still need recorded fixtures, which is the remaining half of KANBAN #8.
- The demo is also the cheapest way to try the hub, so it stays in the repository, not on a branch.
