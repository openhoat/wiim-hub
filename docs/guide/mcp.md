# MCP

The hub's HTTP API is the contract. An MCP server ships beside it, as a client of that contract, so
an agent can read the same state and send the same intents as the page does.

## Why a separate process

- `server/` stays what it is: a node HTTP server with no runtime dependency, and the image keeps
  copying that directory alone. The MCP SDK does not enter the hub.
- The MCP holds no state. Every answer it gives is one the hub already gives to a browser, which is
  also what makes the tools testable without a speaker on the desk.
- Your client starts it on demand, over stdio: nothing to deploy next to the hub, no new port to
  open, no service to keep running between two questions.

## Running it

```sh
WIIM_HUB_URL=http://192.168.1.10:8090 npm run mcp
```

Node 22.18 or newer runs the TypeScript directly, so a clone and one `npm ci` are enough. In a
client that takes a command and an environment (opencode shown here), the two values are the
command and `WIIM_HUB_URL`:

```json
{
  "mcp": {
    "servers": {
      "wiim": {
        "type": "local",
        "command": ["node", "/path/to/wiim-hub/mcp/index.ts"],
        "environment": {
          "WIIM_HUB_URL": "http://192.168.1.10:8090",
          "WIIM_HUB_TOKEN": "the key the hub was given"
        }
      }
    }
  }
}
```

`WIIM_HUB_TOKEN` is optional and is sent as `authorization: Bearer …`. It is the agent's way
in: set on the hub, it makes every `/api/*` route refuse a request that carries neither that
key nor the identity a forward auth left, so an agent never needs the browser session that
would die with its cookie. Left unset, the hub keeps its old contract, the trust of the network
it sits on. Keep the key in this per-server environment rather than in a shell profile: a hub
started on the same machine would inherit it, and its page would start asking for a key. The
server writes MCP on stdout, so its own messages go to stderr: that is where the startup line
`wiim-hub mcp: 4 tools, hub at …` lands.

## The tools

| Tool              | Access | Answers                                                                                    |
| ----------------- | ------ | ------------------------------------------------------------------------------------------ |
| `hub_state`       | reads  | `/api/state`: the fleet as the last poll saw it, with the findings and the guided checks   |
| `device_report`   | reads  | `/api/report`: findings, evidence, inventory, name resolution, and the `markdown` to paste |
| `device_settings` | reads  | `/api/settings`: name, LED, buttons, balance, maximum volume, fade                         |
| `device_command`  | writes | `/api/command`: one intent, the player's own answer in reply                               |

`host` is the speaker as the hub knows it: the name or address it was configured with, or the
address it currently answers on. `device_command` takes the intent as the API body, unchanged, for
example `{"action": "volume", "level": 30}` or `{"action": "seek", "seconds": 42}`; the hub's
validation is the authority on what is accepted, and the reference page lists every intent.

## What is not exposed

Two routes stay out on purpose: writing `/api/hosts` and `/api/discover`. Changing the set of
managed speakers is a configuration act, confirmed in the page, that an agent would be guessing at
from a network it cannot see. Reading the host list is what `hub_state` already tells you.

## Errors

A tool that fails answers `isError: true` with the hub's status and body, so `404 unknown device`,
`409 device offline` and the `400`/`422` validation answers read exactly as they do on the wire. A
hub that does not answer is an answer too: status `0` and `hub unreachable at …: ECONNREFUSED`. The
status is never rewritten into a friendlier sentence, because the sentence would be the only place
the real answer survived.

## The security boundary

- A browser gets in through the ingress, an agent through `WIIM_HUB_TOKEN`. The hub knows no
  user: it reads the identity header its forward auth writes, and the key it was given.
- Whoever holds the key holds the hub's write access: it can play a URL, rename a speaker,
  change the volume of every managed device. Treat it as a device credential, and rotate it in
  the hub's environment when it leaks: a comma separated list lets the old and new key answer
  at the same time.
- Give the agent its own way in, on its own hostname or route, and strip the `X-Auth-Request-*`
  headers there. They prove a session only when the forward auth wrote them; a route that lets a
  client set them hands out an identity, and the hub would believe it.
- Do not put the hub on the internet, and the MCP in a shared agent, and call it covered.

## How it is tested

- `mcp/hub.test.ts` runs the client against a real socket: query building, the token header, a
  refusal kept as an answer, a proxy login page, an empty body, a refused port, a timeout.
- `mcp/tools.test.ts` runs the tools against a fake hub: the paths and query they use, the intent
  forwarded untouched, the hub's error passed through, and the schemas rejecting a key they do not
  name.
- The demo mode is the end-to-end path: `PORT=8080 npm run demo`, then point `WIIM_HUB_URL` at it.
  It serves three simulated players, a running group and an offline one, so both the answer and the
  `409` are one call away.
