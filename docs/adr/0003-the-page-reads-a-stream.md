# 0003 — The page reads a stream, the poll stays

- Status: accepted
- Date: 2026-11-20

## Context

The page asked `/api/state` every three seconds. It works everywhere, it is one route to reason
about, and it is the only way in for a client with no browser: the MCP server, an agent, a script.
It is also the reason a volume changed on a speaker takes up to three seconds to appear, and the
reason a phone in a pocket wakes its radio every three seconds while the app is open.

The hub already knows the fleet at the moment it finishes a tick. The reader is the only side that
has to ask.

## Decision

`GET /api/events` answers `text/event-stream` with one `state` frame per hub tick, carrying the body
`/api/state` would have answered, plus a comment every fifteen seconds so an idle connection
survives a proxy and a sleeping phone. The page reads it with a `fetch` body reader, not
`EventSource` (which cannot send an `Authorization` header, so a hub guarded by `WIIM_HUB_TOKEN`
would refuse it), and falls back to the three-second poll when the stream cannot start, stays
silent for five seconds, or breaks more than three times without delivering.

Nothing is removed: `/api/state` stays the documented contract, the poll remains the backstop that
runs at thirty seconds while the stream delivers, and the MCP client keeps reading the poll.

Server-sent events rather than a WebSocket, because the hub only pushes: the page already writes
through `POST /api/command` and `POST /api/group`. A WebSocket buys a bidirectional channel at the
price of an upgrade every ingress has to allow, while a stream is a plain HTTP response that any
nginx, Caddy or Traefik forwards.

## Consequences

- The stream is one file on each side (`server/stream.ts`, `src/lib/stream.ts`) and no dependency:
  the server still runs on Node built-ins (ADR 0001), and the frame parser is a few dozen lines with
  its own tests.
- An ingress that buffers a proxied response would hold the frames until the end. The header asks it
  not to (`X-Accel-Buffering: no`), and the reader gives up after five silent seconds, so a buffering
  proxy costs a slower page, never a broken one. The installer configures nothing.
- The demo serves the same stream, which is what lets the browser suite prove the fast path instead
  of hoping the poll was fast enough.
- The page holds one open response per tab: a reverse proxy must not cap concurrent requests per
  client at one. The fallback covers it if one does.
