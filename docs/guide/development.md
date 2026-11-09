# Development

Node 22.18 or newer, npm, and that is it. The server runs its TypeScript sources directly; only the
UI needs a build.

```sh
npm ci
npm run build
npm run start:server   # API on :8090, reads .env, restarts on change
npm run start:dev      # Vite on :5173, proxies /api and /health to the API
```

## The gate

`npm run validate` is the one gate, locally and in CI:

- `biome` over `src`, `server`, `e2e`, `scripts` and the configs (lint and format);
- `markdownlint` and `prettier` over the Markdown;
- the unit suite with its coverage thresholds;
- `tsc --noEmit` over the UI, the server, the suite and the configs;
- the Vite build.

The tasks are wired with [wireit](https://github.com/google/wireit), so an unchanged task is not run
twice. `npm run qa:fix` rewrites the formatting instead of reporting it.

CI runs the same gate on Node 22.18 (the floor the package declares) and Node 24, then the
end-to-end suite.

## Tests

The unit suite covers the pure layer on both sides of the HTTP boundary: the intents the hub
accepts, the commands it builds from them, the device parsers pinned against answers a real player
sent (`server/fixtures/`), the per-device write queue, the diagnostic rules, the guided checks, the
capability inventory, the UPnP event hub, and the optimistic reconciliation the page paints before a
poll confirms it.

```sh
npm run test:coverage    # with the thresholds from vitest.config.ts
```

The end-to-end suite drives the demo in a real browser:

```sh
npm run build
npx playwright install chromium
npm run test:e2e
```

Both suites run without hardware. When a behaviour is only observable on a real device, it is
recorded in the [feature research](/feature-research) instead of being asserted.

## Docs

This site is VitePress, built from `docs/`:

```sh
npm run docs:dev      # local preview with hot reload
npm run docs:build    # static build in docs/.vitepress/dist
```

`docs/img/logo.svg` is the source of the mark: `public/favicon.svg` is a copy for the page, and the
site copy is produced from it by `npm run docs:logo`. Edit the source, never a copy.

The site is deployed to GitHub Pages by `.github/workflows/docs.yml` on every push to `main`.

## Conventions

- **Evidence first**: a write command is added only after it was measured on a device, and the
  measurement is recorded in the feature research. An inference is labelled as one.
- **Kanban**: `KANBAN.md` holds open work only. A finished item leaves the board, its story is the
  git history.
- **Decisions**: a decision that is not obvious from the code gets an ADR in `docs/adr/`.
- **Commits**: conventional commits, checked by commitlint on every commit; `pre-commit` and
  `pre-push` run the gate.
- **Sonar** is optional and read by hand: see `CONTRIBUTING.md` for the scan and the static badge.

Full contribution notes: [`CONTRIBUTING.md`](https://github.com/openhoat/wiim-hub/blob/main/CONTRIBUTING.md).
