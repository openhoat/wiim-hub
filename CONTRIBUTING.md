# Contributing

Thanks for taking the time to improve the hub. Small, focused pull requests are the easiest to
review; a design change that touches the server and the UI at once is easier as an issue first.

## Setup

Node 22.18 or newer (the floor declared in `package.json`).

```sh
npm ci
npm run demo        # the interface over two simulated speakers, no device needed
npm run test:e2e    # Playwright drives that demo, Chromium only
```

`npm run demo` and the end-to-end suite are the normal loop. The hub talks to real hardware through
a small number of documented endpoints, and the demo replays their shapes, so most changes never
need a speaker.

## The gate

`npm run validate` is the single gate, locally and in CI:

- `npm run qa`: biome (lint and format), markdownlint and prettier on the Markdown
- `npm run test:coverage`: vitest over the pure server layer, with coverage thresholds
- `npm run typecheck`: `tsc --noEmit` over the UI, the server, the suite and the configs
- `npm run build`: the Vite bundle

The tasks are wired with [wireit](https://github.com/google/wireit), so an unchanged task is not run
twice. `npm run qa:fix` rewrites the formatting instead of reporting it.

## Docs site

The documentation site is VitePress, built from `docs/` and published to GitHub Pages by
`.github/workflows/docs.yml` on every push to `main`:

```sh
npm run docs:dev      # local server with hot reload
npm run docs:build    # static build in dist/docs
```

`docs/img/logo.svg` is the only mark. `public/favicon.svg` is a copy of it for the page (refresh it
when the source changes), and the site copy is produced by `npm run docs:logo`, which the docs build
runs first. Edit the source, never a copy. Diagrams inside the site use Mermaid; the README keeps
plain ASCII, because npmjs.com renders neither.

## Conventions

- **Commits** follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`...), checked
  by commitlint in a Husky hook.
- **Artefacts are in English**: code, comments, documentation, commit messages. The interface is
  localised in `src/locales`.
- **No personal data**: device addresses, speaker names, network identifiers and tokens never land
  in the repository. The demo uses RFC 5737 addresses and synthetic names.
- **Evidence first**: a write command is added only after it was measured on a device, and the
  measurement is recorded in `docs/feature-research.md`. An inference is labelled as one.
- **Kanban**: `KANBAN.md` holds open work only. A finished item leaves the board, its story is the
  git history. Cards stay coarse and point at `docs/feature-research.md` for detail.
- **Decisions**: a decision that is not obvious from the code gets an ADR in `docs/adr/`.

## SonarQube (optional)

The repository ships a `sonar-project.properties` and a `sonar` task. Scanning needs a SonarQube
instance and a token, both taken from the environment, never from the repository:

```sh
SONAR_HOST_URL=... SONAR_TOKEN=... npm run sonar
```

The scan is not part of the pipeline: it runs where the instance is reachable, and the gate it
enforces is read back by hand. That also means the ratings badge in the README header is a static
file (`docs/img/sonar-ratings.svg`), updated at release time when the ratings change, rather than an
image served by a scanner nobody else can query.

## Reporting a bug

Open an issue with the hub version, the speaker model and its firmware (the diagnostic view shows
both) and the steps that reproduce. A screenshot of the diagnostic view, or the exported JSON
report, saves a round trip. Security issues do not go to the tracker: see `SECURITY.md`.
