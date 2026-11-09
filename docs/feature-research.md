# Feature research: what a LinkPlay/WiiM hub can actually do

Research note for WiiM Hub. It inventories the device control surface, separates what was
measured on a real player from what is only documented, and turns it into user facing
requirements. The board in `KANBAN.md` carries the same items at coarse granularity; this file
carries the evidence and the detailed behaviour.

## 1. Method and evidence tiers

Three tiers, always labelled in this document:

- **Measured**: the answer was read from a real device with the probe script below. Exact
  payloads are quoted where the wording matters.
- **Documented**: the command appears in the LinkPlay/WiiM HTTP API reference (version 1.2) or in
  the community OpenAPI document, and is expected to work, but was not run here.
- **Inferred**: derived from several sources, or from the shape of the firmware responses. Treat
  as a hypothesis and probe before relying on it.

Device, group and member names, addresses and uuids are anonymised in the quotations below: the
shapes and the wording are those the firmware returned, the identifiers are not.

Sources:

1. Official PDF, `HTTP API for WiiM Products` (wiimhome.com), version 1.2, the reference for
   command names and parameters.
2. `cvdlinden/wiim-httpapi`, community transcription of that PDF into OpenAPI (346 paths, tags:
   playback, presets, multiroom, audio output, equalizer, room correction, bluetooth, network,
   alarms, device control). Used as the command catalog, because it is machine readable.
3. `mjcumming/pywiim` and the official Home Assistant `wiim` integration (2026.4, platinum
   quality, local push). Valuable less for the commands than for the **behavioural findings**:
   capability probing, unit inconsistencies, per source transport support, firmware quirks.
4. `jaschadub/AAEQ` `WIIM_API_REFERENCE.md`: compact summary of EQ limits and metadata caveats.
5. Direct probes against a WiiM Pro, firmware `Linkplay.4.8.833748` (release `20261027`), player
   named `WiiM Pro` in the examples below.

Reference probe (read only, safe to repeat):

```bash
curl -ks -G "https://<device>:443/httpapi.asp" --data-urlencode "command=getStatusEx"
```

## 2. Transport facts (measured)

| Property       | Observation                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol       | HTTPS on 443 with a self-signed certificate. Plain HTTP on 80 is not served by this firmware.                                             |
| Server         | `lighttpd/1.4.79`, `HTTP/1.1 200 OK`, `Accept-Ranges: bytes`.                                                                             |
| Content type   | **No `Content-Type` header at all.** The body is sometimes JSON, sometimes a bare token.                                                  |
| CORS           | None. No `Access-Control-Allow-*` headers, so a browser page cannot call the device directly: the hub proxies every request.              |
| Method         | GET with a single `command=` parameter. Values that contain JSON are URL encoded.                                                         |
| Payload shapes | JSON object, JSON array, bare `OK`, bare `Failed`, bare `unknown command`, bare number (`0`/`1`), or empty body.                          |
| Root path      | `GET /` hangs instead of answering. Never probe the root as a liveness check.                                                             |
| Latency        | 20 to 60 ms for control commands on the local network; mDNS name resolution is the slow part (0.5 to 6 s measured), not HTTP.             |
| Encoding trap  | `getPlayerStatus` returns `Title`/`Artist`/`Album` as **hex encoded UTF-8** (`476F676F6C` = `Gogol`). Use `getMetaInfo` for display text. |

Consequences for the hub:

- A request that returns `unknown command` is **not** an error: it is the device answering that
  this firmware model does not implement the command. Capability detection must treat it as a
  negative answer, cache it, and never retry in a loop.
- Since `Content-Type` is absent, the client cannot parse on it. Parse on content, and keep the
  raw body for the diagnostic export.
- Command names are case sensitive (`GetAcousticCapability` vs `getAudioInputCapbility`, the
  latter with the firmware's own typo).

## 3. Read surface (measured on the reference player)

| Command                                                                      | Answer                                           | Use                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getStatusEx`                                                                | 2.8 KB JSON, 70+ fields                          | identity, network, capabilities, volume ceiling, group state                                                                                        |
| `getPlayerStatus`                                                            | JSON                                             | transport state, position, volume, mute, loop mode, current vendor                                                                                  |
| `getPlayerStatusEx`                                                          | same body as above here                          | documented as richer; no difference on this firmware                                                                                                |
| `getMetaInfo`                                                                | JSON `metaData`                                  | title, artist, album, cover URL, sample rate, bit depth, bit rate, track id                                                                         |
| `getPresetInfo`                                                              | JSON `preset_num`, `preset_list[]`               | saved radio presets with name, URL, source, picture                                                                                                 |
| `getNewAudioOutputHardwareMode`                                              | `{"hardware":"2","source":"0","audiocast":"0"}`  | active output routing                                                                                                                               |
| `getSoundCardModeSupportList`                                                | array of 3 outputs                               | the **available** outputs (Optical, Line, COAX here)                                                                                                |
| `getAudioInputEnable`                                                        | 4 inputs, `enable` 0/1                           | which inputs the user left enabled in the app                                                                                                       |
| `getAudioInputCapbility`                                                     | 4 inputs                                         | physical inputs present on the model                                                                                                                |
| `getModeRename`                                                              | `Failed` when nothing renamed                    | user defined input labels                                                                                                                           |
| `GetAcousticCapability`                                                      | JSON                                             | GEQ, PEQ (LS/PK/HS/LP/HP), RoomFit, headroom, sub LPF, output delay range                                                                           |
| `EQGetList`                                                                  | 24 preset names                                  | factory EQ presets (`Game` included)                                                                                                                |
| `EQv2GetList:...Eq10HP`                                                      | `{"custom":[],"preset":[...]}`                   | graphic EQ presets, custom ones included                                                                                                            |
| `EQGetLV2SourceBandEx:{...Eq10HP}`                                           | JSON with 10 bands                               | **readable** graphic EQ curve, per source (`source_name: wifi`)                                                                                     |
| `EQGetStat`                                                                  | `{"status":"Failed"}`                            | legacy switch, not the source of truth on this firmware                                                                                             |
| `RoomCorrGet`                                                                | JSON with bands, `EQLevel: 2`                    | RoomFit state and profile                                                                                                                           |
| `getNetworkHealth`                                                           | JSON counters                                    | disconnect counts, last disconnect age and raw message, roaming, DHCP time, abnormal reboots                                                        |
| `getHwErrorInfo`                                                             | JSON                                             | flash bad blocks (5 of 2000 here), `ethError`, `mfiChipError`, `flashSpaceError`, `soundCardHwError`; **no** `temperatureSensorError` on this model |
| `getDebugInfo`                                                               | JSON, ~35 counters                               | `slave_latency`, UPnP action totals/losses, crash counters, `power_ticks` (uptime)                                                                  |
| `getShutdown`                                                                | seconds, `0` when off                            | sleep timer state                                                                                                                                   |
| `LED_SWITCH_GET`                                                             | `1`                                              | status light on/off                                                                                                                                 |
| `Button_Enable_GET`                                                          | `1`                                              | touch controls enabled                                                                                                                              |
| `getDeviceNameChangeable`                                                    | `OK`                                             | name is editable                                                                                                                                    |
| `getChannelBalance`                                                          | `0`                                              | stereo balance                                                                                                                                      |
| `GetFadeFeature`                                                             | `{"FadeFeature":1}`                              | fade in/out support and state                                                                                                                       |
| `get_remote_volume_step`                                                     | `{"status":"OK","remote_volume_step":1}`         | remote volume step                                                                                                                                  |
| `getPowerModeTime`                                                           | JSON                                             | idle, standby, sleep, power off, semi active intervals                                                                                              |
| `streamServicesCapability`                                                   | 2 KB JSON                                        | per service quality tiers (SD/HD/UHD), version, encryption                                                                                          |
| `multiroom:getSlaveList`                                                     | `{"slaves":0,"wmrm_version":"4.3","surround":0}` | group membership                                                                                                                                    |
| `multiroom:getnamegrouplist`                                                 | JSON group list                                  | **saved** group names, ids, channels, update time                                                                                                   |
| `getAlarmClock:<n>`                                                          | `{"enable":"0"}`                                 | alarm slot state                                                                                                                                    |
| `getRoutineCapability`                                                       | `{"version":"1.1"}`                              | routines supported                                                                                                                                  |
| `getAllRoutines`                                                             | `{}` here                                        | device side action sequences (empty: none configured)                                                                                               |
| `getMvRemoteUpdateStartCheck`                                                | `OK`                                             | firmware update check accepted                                                                                                                      |
| `getMvRemoteUpdateStatus`                                                    | `0`                                              | update progress state                                                                                                                               |
| `getInfo`, `getVolume`, `getTracks`, `getPresetList`, `getAudioOutputStatus` | `unknown command`                                | do not use, they exist in older LinkPlay docs                                                                                                       |

Fields worth knowing inside `getStatusEx`, all measured: `DeviceName`, `GroupName`, `project`
(model), `firmware`, `Release`, `hardware`, `uuid`, `MAC`, `RSSI` (-49), `wlanSnr` (35),
`wlanNoise` (-90), `wlanFreq` (5640), `wlanDataRate`, `apcli0` (IP), `eth0`, `internet`, `group`,
`wmrm_version`, `wmrm_capability`, `max_volume` (100), `preset_key` (12 slots), `security`
(`https/2.0`), `upnp_version`, `upnp_uuid`, `BleRemoteControl`, `BleRemoteConnected`,
`audio_channel_config`, `app_timezone_id`, `power_mode`, `privacy_mode`, `temp_uuid`,
`update_check_count`, `streams` (bitmask of supported services), `plm_support`.

The device client is split into pure seams so those shapes are testable without a speaker:
`parseDiagnostics`, `parseDevice`, and one seam per cached probe (`parseCapability`,
`parsePresets`, `parseAcoustic`, `parseRegistry`). `server/device.test.ts` pins them against the
answers a real player returned, sanitised in `server/fixtures/wiim-pro.ts`: hex titles, a number
where a string is documented, `unknown command`, empty bodies, and the `unknow` placeholders. A
seam returns `null` for an answer it cannot read, which is how the caches keep the last good
value instead of blanking a panel. The support report asks those commands once, on demand, and
prints the answer each one gave: that is the capability inventory in §6.

## 4. Write surface (measured on the reference player)

Every command below was sent to the reference player one at a time, and the state it is supposed
to change was read back afterwards. The raw answers are in the appendix; the conclusions are here.

Playback and volume:

- `setPlayerCmd:play|pause|resume|stop|onepause` (`onepause` is the toggle the app uses).
- `setPlayerCmd:prev`, `setPlayerCmd:next`.
- `setPlayerCmd:seek:<seconds>` (documented unit is **seconds**, to be confirmed).
- `setPlayerCmd:vol:<0..max_volume>`, `setPlayerCmd:mute:<0|1>`.
- `setPlayerCmd:loopmode:<n>` where 0 is sequential, others repeat/shuffle families.
- `setPlayerCmd:play:<url>` for a direct stream, `setPlayerCmd:playlist:<url>:<index>` for a
  playlist.
- `MCUKeyShortClick:<preset>` (and `:<preset>:<track>`) to play a saved preset.

Sources and routing:

- `setPlayerCmd:switchmode:<wifi|bluetooth|line-in|optical|udisk|HDMI>`.
- `setAudioOutputHardwareMode:<n>`, values from `getSoundCardModeSupportList` (1 Optical,
  2 Line, 3 COAX on the reference player).
- `setChannelBalance:<n>`, `setMaxVolume:<n>`.

Acoustic:

- `EQLoad:<preset name>`, `EQOn`, `EQOff`, `EQGetList`, `EQGetBand`, `EQSetBand` (the older
  comma separated form is acknowledged but does not change the curve on this firmware, see
  pywiim), `EQGetLV2SourceBandEx` / graphic EQ writer for the 10 band LV2 plugin,
  `RoomCorrSet`, `RoomCorrGet`.

Device and power:

- `setDeviceName:<name>`, `setShutdown:<seconds>` (sleep timer, device powers off),
  `LED_SWITCH_SET:<0|1>`, `Button_Enable_SET:<0|1>`, `reboot`, `restoreToDefault`.
- `setAlarmClock:<n>:<trig>:<op>:<time>:<day>:<url>`, `alarmStop`.

Multiroom:

- `multiroom:getSlaveList`, `multiroom:JoinGroup:IP=<ip>:uuid=<uuid>`,
  `multiroom:LeaveGroup`, `multiroom:Ungroup`, `multiroom:SlaveKickout:<ip>`,
  `multiroom:SlaveVolume:<ip>:<n>`, `multiroom:SlaveMute:<ip>:<0|1>`,
  `multiroom:SlaveChannel:<ip>:<channel>`, `multiroom:getnamegrouplist`.
- `wmrm_version` 4.3 means the modern WiFi multiroom (not the old 10.10.10.x WiFi Direct
  scheme), so members stay reachable at their LAN address.

Bluetooth (only meaningful with the right hardware):

- `getBluetoothHistory`, `scanbta2dpsynk`, `connectbta2dpsynk:<mac>`, disconnect and pair status
  commands. Out of scope until a device reports a Bluetooth output.

### 4.1 Measured behaviour

One write at a time, re-read after each; `curpos`/`totlen` are milliseconds here.

| Write                                  | Answer                                            | Re-read                                                                                | Conclusion                                                                             |
| -------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `setPlayerCmd:pause`                   | `OK`                                              | `status=pause`                                                                         | accepted, state follows                                                                |
| `setPlayerCmd:resume`                  | `OK`                                              | `status=play`                                                                          | resumes a paused stream                                                                |
| `setPlayerCmd:onepause` twice          | `OK`                                              | `pause` then `play`                                                                    | real toggle, usable as one button                                                      |
| `setPlayerCmd:next`                    | `OK`                                              | `status=load`, `totlen=0`                                                              | a transition reads as unknown duration, not as live                                    |
| `setPlayerCmd:prev`                    | `OK`                                              | new track, `status=play`                                                               | the previous track restarts                                                            |
| `setPlayerCmd:seek:60`                 | `OK`                                              | `curpos=60000`                                                                         | **seconds** in, milliseconds out                                                       |
| `setPlayerCmd:vol:30`                  | `OK`                                              | `vol=30`                                                                               | absolute level, within `max_volume`                                                    |
| `setPlayerCmd:mute:1` then `:0`        | `OK`                                              | `mute=1` then `0`                                                                      | boolean flag                                                                           |
| `setPlayerCmd:loopmode:4` then `:0`    | `OK`                                              | `loop=4` then `0`                                                                      | accepted; the mode family is not documented per value                                  |
| `MCUKeyShortClick:1`                   | `OK`                                              | nothing changed                                                                        | answered `OK` with **no preset configured**: the answer does not prove the slot exists |
| `setShutdown:60` then `:0`             | `OK`                                              | `getShutdown=60` then `0`                                                              | sleep timer, cancellable                                                               |
| `EQLoad:Rock`                          | full JSON with `EQStat=On`, `Name=Rock`, 10 bands | curve readable by source                                                               | `EQLoad` answers with the state, not `OK`                                              |
| `EQOff`                                | `{"status":"OK"}`                                 | `EQStat=Off`, `Name=Rock` kept                                                         | off is a switch, not a reset                                                           |
| `setAudioOutputHardwareMode:1`         | `OK`                                              | `hardware=1` (Optical)                                                                 | the mode-name table holds for the routes tested                                        |
| `setAudioOutputHardwareMode:2`         | `OK`                                              | `hardware=2` (Line)                                                                    | restoring the previous route works                                                     |
| `setPlayerCmd:switchmode:optical`      | `OK`                                              | `mode=43`, still playing, `vendor` empty                                               | input switch keeps the transport running                                               |
| `setPlayerCmd:switchmode:wifi`         | `OK`                                              | `mode=10`, `status=stop`                                                               | switching back does **not** resume the stream                                          |
| `EQSetLV2SourceBand` one band          | `OK`                                              | that band changed, the others kept, `Name` **emptied**                                 | a hand-moved band turns the curve into a custom one                                    |
| `EQSetBand:{"EQBand":[{"index":0,…}]}` | `OK`                                              | band 0 read `-10.56` for a requested `6.0`                                             | the v1 payload is not interpreted as a gain: never use it                              |
| `setPlayerCmd:play:<url>`              | `OK`                                              | `mode=10`, `vendor=CustomPushUrl`, title = the address, stream numbers from the stream | the player fetches the address itself, no account                                      |
| `setDeviceName:Living Room Hub`        | `OK`                                              | `DeviceName=Living Room Hub`                                                           | a space survives the query encoding                                                    |
| `LED_SWITCH_SET:0` then `:1`           | `OK`                                              | `LED_SWITCH_GET` follows                                                               | plain flag                                                                             |
| `Button_Enable_SET:0` then `:1`        | `OK`                                              | `Button_Enable_GET` follows                                                            | plain flag                                                                             |
| `setChannelBalance:1`, `:0.5`          | `OK`                                              | read back                                                                              | accepted range -1..1, decimal steps                                                    |
| `setChannelBalance:2`, `:5`, `:10`     | `Failed`                                          | unchanged                                                                              | out of range is refused, not clamped                                                   |
| `setMaxVolume:80` then `:100`          | `OK`                                              | `max_volume` follows                                                                   | the ceiling is a device setting                                                        |
| `SetFadeFeature:0` then `:1`           | `OK`                                              | `{"FadeFeature":0}` then `1`                                                           | JSON answer, not a bare token                                                          |

Consequences for the hub:

- A write answers `OK`, a JSON body, `Failed` or `unknown command`. Anything that is not one of
  the two failure tokens is an acceptance; the body must still be shown when it is not `OK`.
- `seek` takes seconds while `curpos` is in milliseconds: the client divides, the device does not
  convert.
- An input switch can leave the device stopped: after `switchmode` the UI must re-read, never
  assume playback continued.
- `MCUKeyShortClick` is accepted for an empty slot: presets are read from `getPresetInfo`, never
  inferred from the write answer.
- `EQLoad` returns the full curve: the hub can confirm the preset from the write answer itself.
- The equalizer curve belongs to a **source**: read it with an empty `source_name`, then write
  against the source the answer names. Writing a band clears the factory name.
- `EQSetBand` (the v1 payload with an `index`) is accepted but does not apply the value asked:
  `EQSetLV2SourceBand` with `param_name` is the only measured band write.
- A device setting that is out of range answers `Failed` and keeps the previous value: the hub
  bounds the value itself and re-reads after every write.
- `setPlayerCmd:play:<url>` is the only way to start playback without an account; a stream URL is
  accepted only over http or https.

## 5. Requirements by area

Each area lists what the user sees, the behaviour rules, and the edge cases that make or break
the feature. Rules marked **must** are correctness rules, not polish.

### 5.1 Transport control (v2, the core of the hub)

- **Controls**: play/pause toggle, previous, next, stop, seek. Displayed on the now playing card
  and repeated in the device detail view.
- **Optimistic update, then reconcile.** A command flips the local state immediately and marks
  it pending; the next poll (or a short follow up poll, 300 ms) confirms or reverts. Without this
  the UI feels broken at a 3 s polling interval, and it is the single most noticeable quality
  difference against the WiiM app.
- **Per device command mutex.** One in flight command per device, the rest queued and coalesced:
  dragging a volume slider must send one request per idle pause, not forty. Debounce 200 ms,
  coalesce to the last value, never fire two writes concurrently on the same player.
- **Capability gating.** `prev`/`next` and seek are source dependent (streaming services
  manage their own queue but do accept next/prev; Bluetooth and live radio report
  `totlen=0`). Disable seek when `totlen` is 0, and explain why in a tooltip, rather than
  showing a dead slider. Never derive support from `plicount`/`plicurr` (always 0 for
  streaming sources).
- **Unit ambiguity.** `curpos`/`totlen` are milliseconds for local and AirPlay sources, and
  **microseconds** for streaming services on some firmwares. Rule: treat values below
  36 000 000 as milliseconds, above as microseconds, and for known local sources
  (`udisk`, `line-in`, `optical`, `HDMI`) always milliseconds. A track longer than 10 hours
  must still display correctly. The hub applies the rule once, when it parses the player
  answer (`positionMs` in `server/device.ts`), so every view reads milliseconds and the
  frontier is written in one place.
- **Broken firmware states.** Position greater than duration, or a duration below 2 minutes
  with a plausible position, means the duration is wrong: hide the duration, keep the
  position. Never let position exceed duration in the UI.
- **Live streams.** `totlen` 0 means live: no progress bar, no seek, just elapsed time when
  available.
- **Mode label.** `mode` is a source/player family code (10-19 Wiimu playlist, 31 Spotify,
  32 TIDAL, 36 Qobuz, 40 AUX, 41 Bluetooth, and 5 for DLNA cast on newer firmware). Show the
  vendor from `getPlayerStatus.vendor` (`YouTubeMusic` here) plus a mapped label, and fall back
  to the raw code in the diagnostic view when unmapped.
- **Feedback.** Every write reports success or failure. On failure show the device body
  verbatim in the diagnostic view; a `unknown command` on a documented write means the model
  does not support it, so the control must become disabled and stay disabled for the session.

### 5.2 Volume

- Slider plus mute toggle plus a numeric field, all writing `setPlayerCmd:vol:<n>` bounded by
  `max_volume` from `getStatusEx` (100 here, lower on some models).
- Coalescing as above; the slider value must never jump back to the pre-drag poll value.
- Warn above a configurable ceiling (85 % by default) with a one time confirmation, because a
  mis-drag on a 100 W amp is a real event.
- Per device `remote_volume_step` (1 here) and `get_button_volume_step` (unsupported here) only
  matter for remote and button tuning, not for the app slider.

### 5.3 Sources and inputs

- Build the input list from four sources, in this order of authority: `getAudioInputCapbility`
  (physical inputs), `getAudioInputEnable` (user enabled filter), `getModeRename` (display
  labels), `plm_support`/`InputList` (fallback).
- **Never drop the active input**, even when the user disabled it in the app: the state must
  still render.
- Switch with `setPlayerCmd:switchmode:<id>`. Labels are display only; keep the canonical id
  (`optical`, `line-in`, `wifi`, `bluetooth`, `udisk`, `HDMI`) as the stable key, because a
  user can rename Optical to "Phono" and the id must not move.
- Show which inputs are unavailable (no USB key inserted, no HDMI on this model) as disabled
  entries rather than hiding them, so the user understands the model's capability.
- **An external input has no track**, and the firmware does not say so. On the optical input
  (`mode` 43) the device reports `status` honestly (`play` while the TV emits, `stop` otherwise)
  but keeps answering the position of the last stream it played: measured `curpos` 25318,
  `totlen` 137000 and `offset_pts` 15112, with `vendor` empty and `getMetaInfo` returning
  `unknow` for every field (the hex `Title`/`Artist`/`Album` decode to "Unknown", which
  `cleanTitle` already drops). Rendering that payload as is shows a seek bar moving under
  "nothing is playing", so the hub nulls the position for `optical` and `line-in`, keeps the
  transport state, and names the source instead of a track. `bluetooth` is not in that list
  until it is measured the same way.

### 5.4 Presets

- `getPresetInfo` gives name, source, stream URL, cover URL, slot number. A hub can render a
  real preset grid, something the app does well but the community tools often skip.
- Play with `MCUKeyShortClick:<slot>`. Slot numbers are not contiguous in the payload (a
  device can report slots 1 and 6), so key on `number`, never on array index.
- Empty list is the common case on a fresh device (`preset_num: 0` here): show an affordance
  that explains presets are created in the WiiM app, not a broken grid.
- Preset art must be relayed like track art (the device URLs are HTTP, the hub is HTTPS, mixed
  content otherwise). The relay accepts only a URI the device reported, follows no redirect,
  resolves the name once and connects to the checked address, refuses private targets other than
  the speaker itself, sniffs the image type from the bytes, and stops at 6 MiB / 5 s.

### 5.5 EQ and acoustic

- Read: active preset name (`eq` in `getPlayerStatus` is a preset **index**, the LV2 endpoint is
  the source of truth for the curve), 10 band values per source, RoomFit state and profile,
  headroom mode, sub LPF availability.
- Write: `EQLoad:<name>`, `EQOn`/`EQOff`, RoomFit profile load, and (if the 10 band write is
  confirmed on this firmware) individual band gains.
- **Custom curves are device side state**: a band write creates an unsaved curve per source.
  The hub must label it "custom, unsaved" exactly like the app, and never pretend the factory
  preset is still active.
- Factory presets are 24 names including `Game`; custom names come from
  `EQv2GetList` and can collide with factory names. Keep two lists, never merge them into one
  ambiguous dropdown.
- RoomFit profiles are the interesting v3 feature: profile list plus one click apply, because
  the app buries them.

### 5.6 Output routing

- `getSoundCardModeSupportList` is the list of selectable outputs on this firmware (Optical,
  Line, COAX). Switch with `setAudioOutputHardwareMode:<n>`, where `n` is the documented
  hardware mode integer, not the array index of the list (the list `index` field disagrees with
  it, see pywiim). Map by mode name to the documented integer, and probe on each model.
- Show the active route from `getNewAudioOutputHardwareMode`. `audiocast: 1` in `getStatusEx`
  and `audiocast` in the output status are different fields with different meanings; do not
  compare them.
- Changing output is audible and can silence a playing device for a second: confirm once per
  session, or make it an explicit action in the device detail view, never a hover affordance.

### 5.7 Power, timers and alarms

- **Sleep timer**: `getShutdown` returns remaining seconds, `setShutdown:<seconds>` sets it,
  `setShutdown:0` cancels. Present as a small menu (15/30/45/60/90 min, cancel) with a live
  countdown. This is a genuinely useful remote feature.
- **Alarm slots**: `getAlarmClock:<n>` reads, `setAlarmClock` writes. Read only in v3: an alarm
  is a scheduled audible event, and a web hub should not create one by accident.
- **Power mode intervals** (`getPowerModeTime`) are settings for the device's own idle and
  standby behaviour. Display in diagnostics; do not expose as a control.

### 5.8 Multiroom

Measured on the Pro (`Linkplay.4.8.833748`, `wmrm_version` 4.3, `wmrm_sub_ver` 7,
`wmrm_capability` 63):

- `multiroom:getSlaveList` on a player in no group answers
  `{"slaves":0,"wmrm_version":"4.3","surround":0,"group_type":0}`. The documented payload spells
  the keys with a capital (`Slaves`, `Slave_list`) and carries `Name`, `Ip`, `Volume`, `Mute`,
  `Channel`, `Version`; this firmware answers lowercase with an empty list, so both spellings are
  read and neither is assumed to be there.
- `multiroom:getnamegrouplist` holds the groups the vendor app remembers, not the running one:
  `{grouplist:[{group_name:"Apartment",group_id:"6E2A9D14-…",slavelist:[{name:"Bedroom",
uuid:"A1B27C4DE6F0498B93D5E0C7A4F28B61"}]}],current_group_id:"6E2A9D14-…"}`. A saved member carries a
  name and a uuid, no address, and the uuid is not derived from the MAC on this firmware, so a
  member cannot be located from the registry alone.
- `current_group_id` is kept by a player that drives no group: it means "the app points at that
  group", not "this group is running". Only a non-zero `slaves`, or a member list, proves a group
  is live.
- `status.group` is `'0'` on a player in no group, and `GroupName` carries the **device's own
  name** ("Living Room") rather than a group name. The group name therefore comes from the
  registry, and a player with no registry entry shows no group at all.

Shipped read only in 0.4.3: `role` (`master` from a member list, `member` from a group id in the
status, `none` otherwise), the registry entry the device points at, and its members. A saved group
with nothing running is rendered as saved: its members have no address and their state is unknown,
never "offline". A player that is not grouped pays no extra request; one that is, or that points at
a saved group, pays one `getSlaveList` per poll.

Writes wait for a second reachable unit (`multiroom:SlaveVolume`, `multiroom:SlaveMute`,
`multiroom:JoinGroup:IP=…:uuid=…`, `multiroom:LeaveGroup`, `multiroom:SlaveKickout`, and
`setPlayerCmd:slave_vol` for one synchronised volume with coalescing per member). Destructive
actions need a confirmation naming the member and must report the device body on failure. A group
command is not atomic: members apply at slightly different times, so poll the group after a write
and never let the optimistic "grouped" view outlive one poll interval.

### 5.9 Device settings

- Name (`setDeviceName`, only when `getDeviceNameChangeable` is `OK`), status LED, touch
  buttons, stereo balance, max volume, fade in/out. These are low risk writes, but they change
  the physical device: group them in a settings sheet, apply on explicit save, and show the
  device's answer.
- `reboot` and `restoreToDefault` are out of scope for a web hub. Keep them documented in the
  diagnostics page as "possible with the app", never as a button.

### 5.10 Music quality and metadata

- `getMetaInfo` gives `sampleRate`, `bitDepth`, `bitRate` (`44100`, `32`, `257` here). Show them
  as a quality chip (for example `44.1 kHz / 32 bit / 257 kbps`), because "is my stream really
  lossless" is the most asked WiiM question.
- `streamServicesCapability` lists per service quality tiers and versions. Use it to explain
  why a service only offers HD on this model, and to show supported services without guessing.
- Hex encoded metadata in `getPlayerStatus` is a trap: if `getMetaInfo` is absent or empty
  (`subtitle: "unknow"` is normal on Bluetooth), decode the hex fields rather than showing
  gibberish.

### 5.11 Bluetooth

Out of scope for now: the reference player exposes no Bluetooth output, and every Bluetooth
command is a pairing action with physical consequences. Documented only.

### 5.12 Push instead of polling (performance)

Measured on the reference player (WiiM Pro, `Linkplay.4.8.833748`) on 09/11/2026, then implemented
in 0.6.0 as an opt-in.

**What the player advertises.** UPnP on port 49152, HTTP only (TLS is refused). The description
lists five services; two carry playback state: `AVTransport` (`/upnp/event/rendertransport1`) and
`RenderingControl` (`/upnp/event/rendercontrol1`). `SUBSCRIBE` with a `CALLBACK`, `NT: upnp:event`
and `TIMEOUT: Second-300` answers 200 with a `SID` and the granted timeout, and a renewal sent on
the same `SID` answers 200 with the same `SID`; an unknown `SID` answers 412.

**What a notification carries.** An initial `NOTIFY` (SEQ 0) arrives immediately with the whole
state, then one notification per change. A volume or mute write is delivered in under 100 ms, with
`SEQ` incremented by one. The body is a `propertyset` whose `LastChange` property carries an escaped
`Event` document, with the track metadata escaped a second time inside `CurrentTrackMetaData`
(`dc:title`, `upnp:artist`, `upnp:album`, `upnp:albumArtURI`). Transport wording is UPnP
(`PLAYING`, `PAUSED_PLAYBACK`, `STOPPED`), and the device does not emit when a command changes
nothing (resume on an empty queue).

**What it does not carry, and why polling stays.** No position: `RelativeTimePosition` is absent
from the transport event, so the seek bar keeps its polled values. The counters, the group, the
inputs, the equalizer and the sleep timer are not evented either. The subscription therefore
accelerates status, volume, mute, track and duration, and a slow poll keeps the rest.

**Effect, measured through the hub with `SLOW_POLL_MS=15000`.** A volume write made directly on the
device reached `/api/state` in 0.4 s, with `upnp.events` incremented and `updatedAt` untouched: the
value came from the event, not from a poll. The poll cycle is 6 GET (`getStatusEx`,
`getPlayerStatusEx`, `getMetaInfo`, `getNewAudioOutputHardwareMode`, `getShutdown`, the equalizer
query) plus the cached probes, so the cadence goes from 20 cycles and ~120 requests per minute to
4 cycles and ~25 requests per minute: about five times fewer, for a latency roughly thirty times
lower on the evented fields.

**Deployment constraint.** The player pushes to the `CALLBACK` it was given, so the hub must be
reachable from the speaker on the LAN. A container on a bridge network is not, which is why the
subscription is enabled by `UPNP_CALLBACK` (the reachable base URL) and stays off by default; the
callback listener is a dedicated port that answers `NOTIFY` only, on a per-device random path,
validated by source address and by `SEQ`, so it cannot become a second API surface.

**Fallback.** Silence proves nothing on a player nobody touches, so the hub does not age the
subscription out. It declares it degraded, and drops back to the fast poll, when a renewal fails or
when two polls contradict a field the subscription claims to carry; the card then says
`polling fallback` instead of `subscribed`.

## 6. Diagnostic assistance

The hub already shows health. Diagnostic **assistance** means: turn counters into a short list
of findings with evidence, and stop there. No invented root cause, no advice the device cannot
support.

Signals available, all measured on the reference player on 09/11/2026:

| Signal          | Source                                                                                                                                                                             | Reading                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Link quality    | `getStatusEx`: `RSSI`, `wlanSnr`, `wlanNoise`, `wlanFreq`, `wlanDataRate`                                                                                                          | -53 dBm, 35 dB SNR, -91 dBm noise, 433 Mb/s at 5260 MHz; weak below -70 dBm or SNR under 20, band tells 2.4 vs 5 GHz                                              |
| Drop history    | `getNetworkHealth`: `disconnectedCount`, `lastDisconnectedTime`, `lastDisconnectedMsg`, `ethDisconnectedCount`, `pingCheckFailedCount`, `wlanAbnormalRebootTimes`, `wlanRoamingOn` | 2 Wi-Fi drops (last 14 min ago, `lastDisconnectedMsg` carries the raw wpa_supplicant line with its `reason=3`), 1 wired drop, no ping failure, no abnormal reboot |
| Uptime          | `getDebugInfo`: `power_ticks`                                                                                                                                                      | 60 ticks per second; 57219086 ticks is 11 days, so a reboot loop would be visible                                                                                 |
| Crash counters  | `getDebugInfo`: `a01controller_crash`, `asr_tts_crash`, `mcu_crash`, `process_deadlock`                                                                                            | non zero means firmware instability, not the network                                                                                                              |
| UPnP actions    | `getDebugInfo`: `upnp_action_total0..3`, `upnp_action_lost0..3`                                                                                                                    | 456 seen here, none lost; a loss is the device dropping a control, not the hub                                                                                    |
| Flash health    | `getHwErrorInfo`: `badBlockNum` / `totalBlockNum`                                                                                                                                  | 5 of 2000 is the factory state (0.25 %); a rising share matters                                                                                                   |
| Hardware faults | `getHwErrorInfo`: `ethError`, `mfiChipError`, `flashSpaceError`, `soundCardHwError`                                                                                                | directs to hardware, not to the hub                                                                                                                               |
| Transport state | `getPlayerStatus`: `status`                                                                                                                                                        | `stop` with a source selected, `loading` for long, `pause` is normal                                                                                              |
| Group state     | `multiroom:getSlaveList`, `getStatusEx.group`                                                                                                                                      | a device that is a slave but silent is a group problem, not a network one                                                                                         |
| Update state    | `getStatusEx.VersionUpdate`, `NewVer`, `getMvRemoteUpdateStatus`                                                                                                                   | `0` means no update pending or none running                                                                                                                       |
| Sleep timer     | `getShutdown`                                                                                                                                                                      | "the speaker will power off in 12 min" explains a silence                                                                                                         |

**Correction to the earlier spec**: this model answers **no `temperatureSensorError`**. It does
answer `mfiChipError`, `flashSpaceError` and a nested `soundCardHwError` object (`pcm5121` on the
reference unit). A rule that reads a field the device does not send is a rule that never fires, so
the hardware rule reads the fields the device actually answers, and a missing probe stays silent
instead of reading as zero.

**Typing trap, found on the real device**: `getStatusEx` answers strings (`"RSSI":"-53"`) while
`getNetworkHealth` and `getHwErrorInfo` answer **JSON numbers** (`"disconnectedCount":2`,
`"badBlockNum":5`). A parser that only accepts strings reads every counter as `null`, and a rule
that reads a null counter stays silent: the first version of the findings showed nothing on a
device with 2 Wi-Fi drops and 5 bad blocks. `server/diagnostics.test.ts` now pins both shapes.

Shipped in 0.7.0 (`server/findings.ts`, pure module, one rule per signal):

| Finding            | Trigger                                           | Severity | Evidence                            |
| ------------------ | ------------------------------------------------- | -------- | ----------------------------------- |
| `offline`          | the last poll failed; the other rules are skipped | alert    | failure count, last successful poll |
| `weakLink`         | `RSSI <= -70` or `wlanSnr < 20`                   | warn     | RSSI, SNR, noise, band, rate        |
| `wifiDrops`        | `disconnectedCount > 0`                           | warn     | count, age, raw disconnect message  |
| `ethDrops`         | `ethDisconnectedCount > 0`                        | info     | count                               |
| `pingFailures`     | `pingCheckFailedCount > 0`                        | warn     | count                               |
| `abnormalReboots`  | `wlanAbnormalRebootTimes > 0`                     | alert    | count                               |
| `crashCounters`    | the four crash counters sum above zero            | alert    | the four values                     |
| `upnpActionsLost`  | `upnp_action_lost*` sum above zero                | info     | lost of total                       |
| `flashWear`        | `badBlockNum / totalBlockNum >= 2 %`              | warn     | bad blocks, total, ratio            |
| `hardwareFault`    | one of the four hardware error fields is set      | alert    | the field names                     |
| `eventingDegraded` | the UPnP subscription was contradicted by a poll  | info     | miss count                          |
| `sleepTimer`       | `sleepSeconds > 0`                                | info     | minutes                             |

The counters are read on their own 60 s cadence, in three parallel commands, and findings are
recomputed on every `/api/state`: a counter that recovered stops showing, nothing is stored as a
conclusion. `GET /api/report?host=` writes the same findings in English, with the raw answers
appended, for a support thread.

Interpretation rules still open (they need the transport or the group view, not the counters):

1. **Reboot loop**: `power_ticks` lower than the previous reading, not only a non-zero crash
   counter.
2. **Silent device**: transport says `play` but the source is a digital input with no signal
   (`status` idle, `mode` optical/line-in), or the volume is 0, or muted. The sleep timer half
   ships as a finding; mute and volume ship as checks in the guided flow below.
3. **Group mismatch**: this device reports `group: 0` while a master lists it, or the reverse.
   Explain that the state is eventually consistent and show both sides.
4. **Firmware**: an update is available (`VersionUpdate` non zero) or an update is in progress.

**No finding is a finding.** The panel says "No anomaly detected" and lists what it read (RSSI,
SNR, drop count, crash count, UPnP losses, flash blocks), so a clean answer shows its basis
instead of looking like an empty section.

### Guided checks (shipped)

`server/guides.ts` answers the four questions in a fixed order and stops at the first check that is
not a pass, so the last row a reader sees is the first anomaly. The same rules feed the page (in its
language) and the report (in English); the checks are pure and tested without a speaker. `unknown` (a
field the device did not report) stops the flow like an anomaly but is not one: `settled` carries the
difference, so "no anomaly" and "could not tell" never look the same.

| Flow                | Checks, in order                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| No sound            | offline, mute, volume, sleep timer, source (external inputs only), transport, output, group membership |
| It drops            | offline, link, network counters (Wi-Fi, ping, wired, reboots), crash counters                          |
| Wrong output        | offline, active route against the routes the player reports                                            |
| Cannot join a group | offline, group protocol version (`wmrm_version`), role or saved-only group, link                       |

Two orderings carry the diagnosis: the source is read before the transport, so an optical or line
input with no signal is named as such instead of reading as the generic "transport stopped"; and the
link is read before the network counters, because the link rides the poll while the counters need the
slow probes. A pass row states a healthy fact ("The player is not muted.", "The Wi-Fi link is
stable."); a verdict row names the field it read (`getPlayerStatusEx.vol 0`), so a reader can check the
claim instead of trusting it.

The page shows the flows as tabs under the findings, a dot on a tab that has something to say, and
either the "No anomaly on this flow" badge or the stop note. The report adds a `## Guided checks`
section between the findings and the capability inventory: one line per flow, "all N check(s)
passed", or the verdict with its sentence and evidence.

Report export: `GET /api/report?host=` answers `{ts, host, findings, guides, inventory, resolution,
markdown}` and the page offers both copy and download. The Markdown carries the identity, firmware,
link metrics, network name, playback, group, the findings with their evidence lines, the guided
checks, the capability inventory, then the raw answers (`diagnostics`, `link`, the last samples) in a
JSON block. It is the artefact a user pastes into a support thread, and it is English by design: one
artefact, not one per language.

### Capability inventory (shipped with the report)

`server/inventory.ts` probes the eighteen commands the hub depends on, once per report (60 s cache,
no cost per poll), and classifies each answer instead of trusting the firmware's own capability
flags:

| Status        | Meaning                                                     | Measured on the reference player (09/11/2026) |
| ------------- | ----------------------------------------------------------- | --------------------------------------------- |
| `supported`   | anything that is not a known refusal                        | 17 of 18                                      |
| `unsupported` | `unknown command` (the old LinkPlay commands)               | 0                                             |
| `failed`      | `Failed` or `{"status":"Failed"}`: known, refused right now | 1 (`getModeRename`)                           |
| `empty`       | the device answered with an empty body                      | 0                                             |
| `unreachable` | no answer on either scheme after the timeout                | 0                                             |

Four different repair paths, and a support reader needs to tell them apart: a firmware without the
command, a firmware that refuses it, a firmware that answers nothing, and a device that is not
there. A refusal the hub does not recognise counts as `supported` with its body in the table, which
is the honest failure mode: showing the answer beats hiding it behind a guess.

The same section carries the **probe path**: the configured host, the address it resolved to, and
the scheme that answered (`https` on recent firmware, `http` on older builds, `no successful call
yet` before the first answer). `fetchCommand` now records the scheme that answered on the first
attempt too, not only on the fallback, so the report can state it.

Two deliberate choices:

- **The equalizer curve is probed with its argument.** `EQGetLV2SourceBandEx` is only readable with
  the plugin uri and a source name, so the probe sends the real command and the table shows the
  bare name a reader recognises.
- **An offline player is not probed.** Eighteen requests against a dead address cost about five
  seconds and produce eighteen `unreachable` rows; the offline finding already says it, so the
  section states that the probe was skipped and keeps the probe path, which is what matters then.

The demo serves its own inventory, built from the recorded answers plus one `unknown command` and
one empty body, so all four renderable statuses are exercised by the browser suite.

## 7. Interaction rules (apply to every feature)

- **State is a hypothesis.** The hub polls, so every control is optimistic with visible pending
  state, then confirmed by the next poll. A control that is optimistic without reconciliation
  is a lie. The painted value lives six seconds at most and any poll newer than the click erases
  it (`src/lib/optimistic.ts`, tested without a browser).
- **One writer per device.** A queue per device serialises writes; the last value of a slider
  wins. Reads stay parallel.
- **Errors are content.** Show the device body, the command attempted, and the time. Never
  swallow a `Failed`.
- **Disabled beats hidden.** A capability the device does not have is shown disabled with the
  reason, so the user learns the model instead of wondering.
- **Confirmation only for the irreversible or the noisy**: ungroup, max volume, output switch,
  sleep timer cancel. Everything else is one click.
- **Keyboard**: space toggles play, arrows seek by 10 s, up/down volume by 5, `m` mute, `/`
  focuses the device filter, `?` lists shortcuts. Only when focus is not in an input.
- **Screen readers**: the now playing card is a live region with polite announcements, throttled
  to one per 5 s so a progress update does not flood it.
- **Reduced motion**: respect `prefers-reduced-motion` for progress and chart animations.
- **Responsive**: the control surface is thumb reachable on a phone, which is the main use case
  for "change the volume while cooking".
- **i18n**: all strings in `en` and `fr`, no concatenated sentences, numbers via `Intl`, no
  hardcoded unit strings.
- **No secrets in the UI**: the Wi-Fi password returned by `getNetwork` must never be fetched by
  the hub.

## 8. Non-goals

- Account, cloud, Alexa and Tidal/Spotify login flows: the hub is local only.
- Firmware update execution (`getMvRemoteUpdateStart`) and factory reset.
- Wi-Fi network reconfiguration, static IP, hidden AP, SSID changes.
- Any write that the current firmware answers with `unknown command`, until it is proven on a
  real device.

## 9. Roadmap mapping

| Area                                 | Card                 | Scope                                                                                      |
| ------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------ |
| Transport, volume, sources, seek     | v2 remote control    | probe first, then controls, optimistic state, queue                                        |
| Presets                              | v2 remote control    | grid, play by slot, relayed art                                                            |
| Output routing, EQ read, sleep timer | v2 remote control    | read first, one write each                                                                 |
| Diagnostic assistance                | diagnostic assistant | findings with evidence, guided flows, report export (findings and report shipped in 0.7.0) |
| Multiroom                            | v3                   | group card, per member volume, join/leave                                                  |
| UPnP events                          | performance          | replace polling, fallback kept                                                             |

## Appendix: v2 write probe, executed

Run in this order, one at a time, on a player allowed to make noise. Record the raw body and
re-read the state after each write. Executed on the reference player on 08/11/2026; the log is
kept outside the repository (`/tmp/opencode/wiim-write-probe.log`), the conclusions are in 4.1.

1. `setPlayerCmd:pause` then `setPlayerCmd:resume`, confirm with `getPlayerStatus.status`.
2. `setPlayerCmd:onepause` twice, confirm the toggle semantics.
3. `setPlayerCmd:next` and `setPlayerCmd:prev`, confirm the title changes.
4. `setPlayerCmd:seek:60`, confirm `curpos` near 60000 (milliseconds) or 60000000
   (microseconds).
5. `setPlayerCmd:vol:30` then restore, confirm `vol`.
6. `setPlayerCmd:mute:1` then `0`, confirm `mute`.
7. `setPlayerCmd:loopmode:0` to `4`, confirm `loop`.
8. `MCUKeyShortClick:1` with a preset configured, confirm the stream changes.
9. `setAudioOutputHardwareMode:<n>` to an available route and back, confirm with
   `getNewAudioOutputHardwareMode`.
10. `setShutdown:60` then `setShutdown:0`, confirm with `getShutdown`.
11. `EQLoad:<preset>` then `EQOff`, confirm with `EQGetLV2SourceBandEx`.
12. `setPlayerCmd:switchmode:optical` and back to `wifi`, confirm `mode` and `status`.

Steps 1 to 12 all ran; step 8 could not confirm a stream change because the reference player has
no preset configured (`preset_num: 0`), so the acceptance of `MCUKeyShortClick` on an empty slot is
the only observable there.
