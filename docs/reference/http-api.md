# HTTP API

The hub serves one page and a small JSON API. Everything below is what the page uses; there is no
public contract beyond it, and the shapes follow the device readings rather than a schema invented
for the browser.

| Route                                 | Method | Answer                                                                                     |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `/health`                             | GET    | `ok`, for container healthchecks. Reads no device.                                         |
| `/api/state`                          | GET    | Devices with their state, samples, events and the findings of the moment                   |
| `/api/report?host=<address>`          | GET    | The diagnostic report as Markdown (English), with the raw answers and the findings as JSON |
| `/api/settings?host=<address>`        | GET    | Name, LED, touch controls, balance, maximum volume and fade, read live                     |
| `/api/command?host=<address>`         | POST   | One intent, written through the per-device queue; answers with the device body             |
| `/api/discover`                       | POST   | One SSDP pass, then an immediate poll; answers with the number of devices found            |
| `/api/art?host=<address>&uri=<cover>` | GET    | Album art or preset art, relayed by the hub                                                |
| `/api/hosts`                          | GET    | The addresses the hub polls: `host`, `ip`, `name`, `online` and the list it came from      |
| `/api/hosts`                          | POST   | Add a host, `{ "host": "…" }`; answers the new list, or the reason it was refused          |
| `/api/hosts`                          | PUT    | Change the address of a saved host, `{ "from": "…", "to": "…" }`                           |
| `/api/hosts?host=<address>`           | DELETE | Remove a saved host; a seed from the environment and a discovered entry are refused        |

## Intents

`POST /api/command` takes an intent, never a raw device command: the server owns the mapping from
intent to the firmware command. The body is JSON.

| Intent                                            | Fields                 |
| ------------------------------------------------- | ---------------------- |
| `play`, `pause`, `toggle`, `stop`, `next`, `prev` | none                   |
| `seek`                                            | `seconds`              |
| `volume`                                          | `level`                |
| `mute`                                            | `muted`                |
| `source`                                          | `input`                |
| `preset`                                          | `slot`                 |
| `sleep`                                           | `seconds`, `0` cancels |
| `output`                                          | `hardware` (index)     |
| `eq`                                              | `enabled`              |
| `eqPreset`                                        | `name`                 |
| `eqBand`                                          | `band`, `value` in dB  |
| `rename`                                          | `name`                 |
| `led`, `buttons`, `fade`                          | `on`                   |
| `balance`                                         | `value` in -1..1       |
| `maxVolume`                                       | `level`                |
| `url`                                             | `url`, http or https   |

Validation happens against the last known state, and a refused intent answers with the reason
instead of reaching the speaker:

- the volume is bounded by the device's own `max_volume`;
- an input or an output must be one the device reports;
- an equalizer band must be one of the ten names the firmware matches, and the gain stays inside
  the measured range;
- a stream URL must be http or https, and its length is bounded by what the device accepts.

An intent that reaches the device and comes back `unknown command` is recorded as unsupported for
that device: the page then shows the control as unsupported rather than offering a button that
never works.

## The report

`GET /api/hosts` answers the list the devices dialog shows. Only a `saved` entry can be changed or
removed: `env` comes from `DEVICE_HOSTS`, which the hub reads and never writes, and `discovered`
comes back on the next SSDP pass, so removing it would not hold. Writes take a JSON body, for the
same reason the command route does: an HTML form cannot send that content type, so a cross-site
post cannot make the hub poll an address of someone else's choosing.

`GET /api/report?host=<address>` answers a JSON object with the findings, the guided checks, the
inventory, the resolution path and a `markdown` field. The Markdown is English and self-contained:
readings table, findings with their evidence, guided checks, capability inventory, raw answers. It
is the artefact to attach to a support thread.

## Cover relay rules

`/api/art` only accepts a URI the device itself reported on its last poll, track or preset. It then
resolves the name once, connects to the address it checked, refuses private and link-local targets
except the speaker's own address, decides the type from the first bytes, and stops at 6 MiB or 5 s.
A refusal is logged with its reason. See [How it works](/how-it-works#the-cover-relay).

## Authentication

None, by design: identity belongs to the ingress. Beside `/health`, every route reads or writes a
device. Put the hub behind a forward-auth proxy on a private network; see
[Configuration](/guide/configuration#behind-a-reverse-proxy).
