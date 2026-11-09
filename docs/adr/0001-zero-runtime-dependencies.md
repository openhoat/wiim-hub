# 0001 — The server runs on Node built-ins only

- Status: accepted
- Date: 2026-11-09

## Context

The hub ships as a small container next to the speakers. It has to start fast, survive without an
`npm ci` at runtime and stay auditable. Its job is narrow: poll a handful of devices and serve one
page. Every dependency would also become a security surface and a supply-chain path in a tool that
listens to the local network.

## Decision

The server (`server/`) imports Node built-ins (`node:http`, `node:dgram`, `node:dns`, `node:net`)
and nothing else. The UI is bundled by Vite and served as static files, so its dependencies are
build time only and never reach the runtime image. The runtime stage of the Dockerfile copies
`server/` and the built bundle.

## Consequences

- The HTTP router, the SSDP discovery, the mDNS resolver and the request timeouts are ours: about a
  thousand lines with no framework to fall back on. That code needs tests more than a framework
  would, which is why the pure layer carries a unit suite.
- A feature that genuinely needs a dependency (a database driver, a scheduler) needs an ADR first,
  and the question "can Node or the device API do it" before that.
- The image stays a two-stage build with no `node_modules` in the runtime layer.
