# Security Policy

## Reporting a vulnerability

Please report a vulnerability privately, through the repository's GitHub security advisories or by
contacting the maintainer, rather than in a public issue. Include the hub version, the speaker model
and firmware, and the impact you expect. We acknowledge receipt within 48 hours.

## Scope

The hub is built to run on a trusted local network. It has no authentication of its own: put it
behind a reverse proxy that does, and never expose it directly to the internet.

In scope:

- the HTTP server (`server/server.ts`): routing, body limits, path traversal, the album art relay
- the write path: intent validation, the per-device queue, the commands sent to devices
- the UI bundle and its build

Out of scope:

- a speaker that accepts commands from the whole network (the hub does not add that exposure)
- a deployment that puts the hub on a public address without a proxy
