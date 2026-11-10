# Quick start

The hub is one process and one page. It needs nothing else: no database, no external account, no
runtime dependency beyond Node and the speakers on your network.

## With Docker

The published image is `ghcr.io/openhoat/wiim-hub` (`linux/amd64`):

```sh
docker run --rm -p 8090:8090 \
  -e DEVICE_HOSTS=192.168.1.10,living-room.local,kitchen \
  ghcr.io/openhoat/wiim-hub:latest
```

Then open `http://localhost:8090`.

To build the image yourself instead:

```sh
docker build -t wiim-hub .
docker run --rm -p 8090:8090 -e DEVICE_HOSTS=192.168.1.10 wiim-hub
```

Or start from [`examples/compose.yml`](https://github.com/openhoat/wiim-hub/blob/main/examples/compose.yml):

```sh
cd examples && docker compose up -d
```

::: tip Containers and discovery
SSDP discovery is a multicast exchange, and it does not cross every container network. With the
default bridge, set `DEVICE_HOSTS` explicitly; use `network_mode: host` if you want discovery to
work from inside the container.
:::

## From sources

The UI is a React application built by Vite; the server is plain TypeScript. Node 22.18+ runs the
server sources directly, so only the UI needs a build.

```sh
npm ci
cp .env.example .env    # one file, read by the server on start
npm run build           # writes dist/app/
npm start               # server and built UI on :8090
```

`start` and `start:server` read `.env` through `--env-file-if-exists`, so the device list lives in
one file instead of a shell export. A variable already set in the environment wins over the file,
and a missing file is not an error: the defaults from [Configuration](/guide/configuration) apply.
`.env` is ignored by git; `.env.example` is the template.

For UI work, run the two processes side by side:

```sh
npm run start:server    # API on :8090, reads .env, restarts on change
npm run start:dev       # Vite on :5173, proxies /api and /health to the API
```

`start:dev` is the UI only: it never starts the API, so a stale API left on :8090 keeps answering
the Vite proxy until you restart it. When the cards do not match the file, that is the first thing
to check.

## Without a speaker

The repository ships a demo mode: three simulated players, a running group and an offline speaker,
deterministic signal history, generated covers and the real write path.

```sh
npm ci
npm run build
npm run demo            # http://localhost:8090, PORT=8091 to move it
```

See [Demo mode](/guide/demo) for what is simulated and how the end-to-end suite uses it.

## What to do next

1. Put the hub behind the authentication of your ingress. It has no login of its own, by design.
   See [Configuration](/guide/configuration#behind-a-reverse-proxy).
2. Add the devices, either by address or by name: [Devices](/guide/devices).
3. If the hub and the speakers share a network, turn on [UPnP events](/guide/events): the playback
   fields then arrive in under a second and the poll relaxes.
4. Install it as an app: Chrome and Edge offer it from the address bar, and the page then gets a
   window of its own with the project's icon. On iOS and iPadOS, Share then Add to Home Screen.
   Installed or not, a service worker caches the page itself and never the API: the shell opens
   without a network, and when the hub stops answering the cards keep the last state they received,
   dated under the banner.
