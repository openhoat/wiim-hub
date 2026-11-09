# Glossary

The vocabulary this code uses. Prefer these words in code, issues and tests.

## Intent

What the browser sends to the hub (`POST /api/command`): an action such as `volume`, `seek` or
`eqBand` with its value. Never a device command. `parseAction` in `server/commands.ts` turns the
body into one, or refuses it.

## Command

The line the device expects (`setPlayerCmd:vol:30`, `EQSetLV2SourceBand:...`), built from an intent
and from the state the hub has. `commandFor` is the only place that builds one.

## Outcome

What the device answered to a command: success, a failure, or `unknown command`. The last one is a
capability answer, not a transient error: the hub shows the feature as unsupported and stops
offering it.

## Write queue

The per-device writer that keeps one command in flight at a time, so two writes cannot interleave.
It lives in `server/queue.ts`.

## Family

The marker `commandFor` puts on the commands a drag can repeat (volume, seek, balance, one eq band).
The queue replaces a pending job of the same family instead of appending, so a slider sends its
final value rather than forty intermediate ones.

## Patch and state

A poll returns a `DevicePatch`: what the device says right now. The hub retains a `DeviceState` per
host, which is that patch plus the history the page renders (samples, events, last seen).

## Capability probe

A read that tells whether the firmware supports a feature (`getSoundCardModeSupportList`,
`streamServicesCapability`...). A missing answer is remembered per firmware and never guessed.

## Group roles

`master` drives a running group, `member` follows one, `none` drives nothing. A saved group exists
in the vendor app but runs nothing: `saved` says so, and the hub keeps listing the members the
speaker remembers.

## Registry

The saved groups the device reports (`multiroom:getnamegrouplist`), cached for a minute. It is the
only source of a group name: `GroupName` carries the device's own name on this firmware.

## Demo mode

`server/demo.ts`: two simulated speakers serving the real UI bundle, with no device and no extra
dependency. The end-to-end suite drives it, and the README screenshots come from it.

## Evidence tier

How well a payload or a unit is known: measured on a device, read from a vendor configuration, or
inferred. `docs/feature-research.md` labels each one; an inference is never a documented fact.
