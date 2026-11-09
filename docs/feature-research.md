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

| Command                                                                      | Answer                                           | Use                                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `getStatusEx`                                                                | 2.8 KB JSON, 70+ fields                          | identity, network, capabilities, volume ceiling, group state                       |
| `getPlayerStatus`                                                            | JSON                                             | transport state, position, volume, mute, loop mode, current vendor                 |
| `getPlayerStatusEx`                                                          | same body as above here                          | documented as richer; no difference on this firmware                               |
| `getMetaInfo`                                                                | JSON `metaData`                                  | title, artist, album, cover URL, sample rate, bit depth, bit rate, track id        |
| `getPresetInfo`                                                              | JSON `preset_num`, `preset_list[]`               | saved radio presets with name, URL, source, picture                                |
| `getNewAudioOutputHardwareMode`                                              | `{"hardware":"2","source":"0","audiocast":"0"}`  | active output routing                                                              |
| `getSoundCardModeSupportList`                                                | array of 3 outputs                               | the **available** outputs (Optical, Line, COAX here)                               |
| `getAudioInputEnable`                                                        | 4 inputs, `enable` 0/1                           | which inputs the user left enabled in the app                                      |
| `getAudioInputCapbility`                                                     | 4 inputs                                         | physical inputs present on the model                                               |
| `getModeRename`                                                              | `Failed` when nothing renamed                    | user defined input labels                                                          |
| `GetAcousticCapability`                                                      | JSON                                             | GEQ, PEQ (LS/PK/HS/LP/HP), RoomFit, headroom, sub LPF, output delay range          |
| `EQGetList`                                                                  | 24 preset names                                  | factory EQ presets (`Game` included)                                               |
| `EQv2GetList:...Eq10HP`                                                      | `{"custom":[],"preset":[...]}`                   | graphic EQ presets, custom ones included                                           |
| `EQGetLV2SourceBandEx:{...Eq10HP}`                                           | JSON with 10 bands                               | **readable** graphic EQ curve, per source (`source_name: wifi`)                    |
| `EQGetStat`                                                                  | `{"status":"Failed"}`                            | legacy switch, not the source of truth on this firmware                            |
| `RoomCorrGet`                                                                | JSON with bands, `EQLevel: 2`                    | RoomFit state and profile                                                          |
| `getNetworkHealth`                                                           | JSON counters                                    | disconnect counts, last disconnect age, roaming, DHCP time, abnormal reboots       |
| `getHwErrorInfo`                                                             | JSON                                             | flash bad blocks (5 of 2000 here), sound card, thermal, LED errors                 |
| `getDebugInfo`                                                               | JSON, ~35 counters                               | `slave_latency`, UPnP action totals/losses, crash counters, `power_ticks` (uptime) |
| `getShutdown`                                                                | seconds, `0` when off                            | sleep timer state                                                                  |
| `LED_SWITCH_GET`                                                             | `1`                                              | status light on/off                                                                |
| `Button_Enable_GET`                                                          | `1`                                              | touch controls enabled                                                             |
| `getDeviceNameChangeable`                                                    | `OK`                                             | name is editable                                                                   |
| `getChannelBalance`                                                          | `0`                                              | stereo balance                                                                     |
| `GetFadeFeature`                                                             | `{"FadeFeature":1}`                              | fade in/out support and state                                                      |
| `get_remote_volume_step`                                                     | `{"status":"OK","remote_volume_step":1}`         | remote volume step                                                                 |
| `getPowerModeTime`                                                           | JSON                                             | idle, standby, sleep, power off, semi active intervals                             |
| `streamServicesCapability`                                                   | 2 KB JSON                                        | per service quality tiers (SD/HD/UHD), version, encryption                         |
| `multiroom:getSlaveList`                                                     | `{"slaves":0,"wmrm_version":"4.3","surround":0}` | group membership                                                                   |
| `multiroom:getnamegrouplist`                                                 | JSON group list                                  | **saved** group names, ids, channels, update time                                  |
| `getAlarmClock:<n>`                                                          | `{"enable":"0"}`                                 | alarm slot state                                                                   |
| `getRoutineCapability`                                                       | `{"version":"1.1"}`                              | routines supported                                                                 |
| `getAllRoutines`                                                             | `{}` here                                        | device side action sequences (empty: none configured)                              |
| `getMvRemoteUpdateStartCheck`                                                | `OK`                                             | firmware update check accepted                                                     |
| `getMvRemoteUpdateStatus`                                                    | `0`                                              | update progress state                                                              |
| `getInfo`, `getVolume`, `getTracks`, `getPresetList`, `getAudioOutputStatus` | `unknown command`                                | do not use, they exist in older LinkPlay docs                                      |

Fields worth knowing inside `getStatusEx`, all measured: `DeviceName`, `GroupName`, `project`
(model), `firmware`, `Release`, `hardware`, `uuid`, `MAC`, `RSSI` (-49), `wlanSnr` (35),
`wlanNoise` (-90), `wlanFreq` (5640), `wlanDataRate`, `apcli0` (IP), `eth0`, `internet`, `group`,
`wmrm_version`, `wmrm_capability`, `max_volume` (100), `preset_key` (12 slots), `security`
(`https/2.0`), `upnp_version`, `upnp_uuid`, `BleRemoteControl`, `BleRemoteConnected`,
`audio_channel_config`, `app_timezone_id`, `power_mode`, `privacy_mode`, `temp_uuid`,
`update_check_count`, `streams` (bitmask of supported services), `plm_support`.

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
  must still display correctly.
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

- The device exposes UPnP on port 49152 (`upnp_version: 1005`, `communication_port: 8819`) and
  Home Assistant subscribes to UPnP events for immediate state changes, with HTTP polling only
  for availability. This is the long term path for the hub: an event subscription would remove
  the 3 s poll and make the UI feel native.
- Costs: one subscription per device, renewal every few minutes, a callback URL that must be
  reachable from the device (so the hub must be on the same network, which it is), and a
  fallback to polling when events stop. Worth a dedicated card, not a v2 requirement.

## 6. Diagnostic assistance

The hub already shows health. Diagnostic **assistance** means: turn counters into a short list
of findings with evidence, and stop there. No invented root cause, no advice the device cannot
support.

Signals available, all measured:

| Signal          | Source                                                                                                                              | Reading                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Link quality    | `getStatusEx`: `RSSI`, `wlanSnr`, `wlanNoise`, `wlanFreq`, `wlanDataRate`                                                           | -49 dBm and 35 dB SNR is good; below -70 dBm or SNR under 20 is weak; band tells 2.4 vs 5 GHz |
| Drop history    | `getNetworkHealth`: `disconnectedCount`, `lastDisconnectedTime`, `wlanAbnormalRebootTimes`, `pingCheckFailedCount`, `wlanRoamingOn` | counters plus age, so "3 drops, last 40 min ago" is a fact                                    |
| Uptime          | `getDebugInfo`: `power_ticks`                                                                                                       | 60 ticks per second; long uptime rules out a reboot loop                                      |
| Crash counters  | `getDebugInfo`: `mcu_crash`, `a01controller_crash`, `process_deadlock`                                                              | non zero means firmware instability, not the network                                          |
| Flash health    | `getHwErrorInfo`: `badBlockNum` / `totalBlockNum`                                                                                   | 5 of 2000 is normal; a rising share matters                                                   |
| Hardware faults | `getHwErrorInfo`: `ethError`, `soundCardHwError`, `temperatureSensorError`                                                          | directs to hardware, not to the hub                                                           |
| Transport state | `getPlayerStatus`: `status`                                                                                                         | `stop` with a source selected, `loading` for long, `pause` is normal                          |
| Group state     | `multiroom:getSlaveList`, `getStatusEx.group`                                                                                       | a device that is a slave but silent is a group problem, not a network one                     |
| Update state    | `getStatusEx.VersionUpdate`, `NewVer`, `getMvRemoteUpdateStatus`                                                                    | `0` means no update pending or none running                                                   |
| Sleep timer     | `getShutdown`                                                                                                                       | "the speaker will power off in 12 min" explains a silence                                     |

Interpretation rules (each finding carries its evidence line, the value and its source):

1. **Offline**: transport error for more than 3 polls. Then try mDNS re-resolution, then the
   last known IP, then declare offline. Report which attempt failed, because "the name does not
   resolve" and "the address refuses connections" are different problems.
2. **Unstable link**: `disconnectedCount` grew since the last snapshot, or RSSI under -70 dBm,
   or SNR under 20. Evidence: the counters and their timestamps.
3. **Reboot loop**: `power_ticks` lower than the previous reading, or a crash counter
   incremented.
4. **Silent device**: transport says `play` but the source is a digital input with no signal
   (`status` idle, `mode` optical/line-in), or the volume is 0, or muted, or a sleep timer is
   armed. These four are ordinary causes and must be checked before the network.
5. **Group mismatch**: this device reports `group: 0` while a master lists it, or the reverse.
   Explain that the state is eventually consistent and show both sides.
6. **Firmware**: an update is available (`VersionUpdate` non zero) or an update is in progress.
7. **No finding**: say so explicitly. "No anomaly detected, 14 h uptime, -49 dBm" is a valid and
   useful answer.

Guided flows (deterministic, no LLM needed):

- "No sound": check mute, volume, sleep timer, source, transport, output route, in that order,
  and stop at the first failing check.
- "It drops": pull `getNetworkHealth` before and after a 60 s window, show the delta.
- "Wrong output": show the active route and the available routes side by side.
- "Cannot join group": show both devices' `wmrm_version`, group state and RSSI (a slave on 2.4
  GHz far from the master is a classic cause).

Report export: one JSON file per device with `device` (identity, model, firmware, uptime),
`network` (link metrics, health counters), `hardware` (error info), `playback` (status, meta,
output, group), `capabilities` (every probed command with `supported`, raw body, and the time of
probing), and `hub` (version, poll interval, resolution path). Plus a human readable Markdown
summary. This is the artefact a user pastes into a support thread, and it is also the artefact
that makes a bug report actionable without asking the user to run curl.

## 7. Interaction rules (apply to every feature)

- **State is a hypothesis.** The hub polls, so every control is optimistic with visible pending
  state, then confirmed by the next poll. A control that is optimistic without reconciliation
  is a lie.
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

| Area                                 | Card                 | Scope                                               |
| ------------------------------------ | -------------------- | --------------------------------------------------- |
| Transport, volume, sources, seek     | v2 remote control    | probe first, then controls, optimistic state, queue |
| Presets                              | v2 remote control    | grid, play by slot, relayed art                     |
| Output routing, EQ read, sleep timer | v2 remote control    | read first, one write each                          |
| Diagnostic assistance                | diagnostic assistant | findings with evidence, guided flows, report export |
| Multiroom                            | v3                   | group card, per member volume, join/leave           |
| UPnP events                          | performance          | replace polling, fallback kept                      |

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
