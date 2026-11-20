# Kanban

Board conventions follow the `task-format` rule: stable `#N` numbers, `[CATEGORY]` plus optional
`(P1|P2|P3)` in the Backlog, `[TAG]` in In Progress, and no Done column (git history is the
record). An item moved to In Progress keeps its number and gains a start timestamp.

Detailed requirements live in `docs/feature-research.md`; cards stay coarse and point there.
Fine grained work in progress goes to the gitignored `.scratch/<slug>/` directory, never here.

## Backlog

### #1 [PERFORMANCE] Add an event stream for the fleet state, with a polling fallback (P2)

- [ ] Serve `/api/events` as `text/event-stream`, authenticated like `/api/*`: one state event per
      tick, a heartbeat comment to keep proxies awake, the demo fleet included
- [ ] Read the stream from the page with a `fetch` body reader (the bearer header rules out
      `EventSource`), reconnect on a growing delay, and fall back to the 3 s poll when the stream
      cannot start or keeps breaking
- [ ] Keep a slow poll as a backstop, so a missed event never outlives a tick
- [ ] Document the stream in `reference/http-api` and the fallback in the guide; cover both paths in
      the e2e suite (a write seen by another context, and a page that lives on the poll alone)

### #2 [UX] Add media session controls, from the lock screen of a phone (P3)

- [ ] Publish the transport of the card the page drives as a media session, so play, pause and
      next reach the group from the lock screen while the PWA is open
