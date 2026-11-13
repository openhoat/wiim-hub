# Features

Everything the hub does today, grouped by what you would go looking for, with a link to the page
that explains each part. Nothing here is planned: a feature that does not ship is not on this page,
and the behaviours measured on a real player are recorded in the
[feature research](/feature-research).

## On the page

| Feature                                                     | What you get                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [One card per speaker](/guide/devices#one-card-per-speaker) | Album art, track, progress, volume and source, or the raw fields, signal samples and event log of the same device |
| [Two views, one dataset](/how-it-works#the-page)            | A now playing view for everyday use, a diagnostic view for support, switched from the header                      |
| [An order that stays](/how-it-works#the-page)               | The arrows in a card header set the order you chose, per browser; a diagnostic card folds to its header           |
| [Controls that answer first](/how-it-works#the-page)        | A control paints the value you asked for, and the next poll confirms or reverts it                                |
| [A phone, really](/how-it-works#the-page)                   | Sheets sit above the on screen keyboard instead of under it                                                       |
| [Language and theme](/how-it-works#the-page)                | English or French, light or dark, following the browser unless you say otherwise                                  |
| [Installed like an app](/how-it-works#updates)              | The shell opens without a network, the last state stays readable and its clock stops                              |
| [Updates without a reinstall](/how-it-works#updates)        | A new worker waits for your click, then reloads once, keeping the view and the last state                         |

## The fleet

| Feature                                                            | What you get                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| [An explicit list, or discovery](/guide/devices#discovery)         | Addresses from the environment, hosts saved from the page, or one SSDP pass that finds the rest               |
| [Manage from the page](/guide/devices#adding-a-host-from-the-page) | Add, rename or remove a saved host; an address that came from the environment stays read only                 |
| [Names resolved in a stated order](/guide/configuration#names)     | Static pairs, the router's lease file, the system resolver, then mDNS, and the report says which one answered |
| [A mixed fleet is the normal case](/guide/devices#a-mixed-fleet)   | Pro, Mini, Amp, Ultra and OEM players side by side, each probed for what it supports                          |
| [A running group is one card](/guide/devices#multiroom-read-only)  | The group's name, the speaker that drives it, and every speaker as a row with its own volume                  |
| [External inputs](/guide/devices#external-inputs)                  | A player on optical, line or coax is shown playing that input, with no track invented                         |

## Control

| Feature                                                    | What you get                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [Playback](/reference/http-api#intents)                    | Play, pause, toggle, stop, next, previous, seek in seconds, volume and mute                                              |
| [Sources and sleep](/reference/http-api#intents)           | Switch input, set a sleep timer the player counts down itself                                                            |
| [Audio route](/reference/http-api#intents)                 | Choose the output the player should drive, when it publishes the list                                                    |
| [A stream URL](/reference/http-api#intents)                | Hand the player a URL it fetches itself, so the stream outlives the hub                                                  |
| [Saved presets](/feature-research#_5-4-presets)            | The slots the player holds, browsed from a sheet with cover, name and service; the player resolves a service slot itself |
| [Equalizer](/feature-research#_5-5-eq-and-acoustic)        | On or off, presets, bands, RoomFit, and the quality the device reports                                                   |
| [Device settings](/reference/http-api)                     | Name, LED, front buttons, balance, maximum volume and fade                                                               |
| [One queue per speaker](/how-it-works#the-write-path)      | Writes to a device are serialised, so two gestures cannot race each other                                                |
| [Intents, never raw commands](/reference/http-api#intents) | The body is an intent the hub maps itself, so no caller can send an arbitrary firmware command                           |

## Diagnostics

| Feature                                                              | What you get                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Findings with their numbers](/how-it-works#findings-and-the-report) | Each rule quotes the field it read: dropped connections, hardware faults, lost UPnP actions |
| [Guided checks](/how-it-works#the-guided-checks)                     | The "no sound" flow reads the group's transport when the speaker follows one                |
| [A report you can paste](/reference/http-api)                        | The same findings as English Markdown, with the raw answers behind them                     |
| [A capability inventory](/how-it-works#the-capability-inventory)     | Which commands the firmware answered, which said unknown, remembered for a day              |
| [Streaming services and tiers](/how-it-works#the-streaming-tiers)    | The services the firmware can drive, with the formats or bitrates it publishes for each     |
| [The cover relay](/how-it-works#the-cover-relay)                     | Album art fetched by the hub, only for a URI the player itself reported                     |

## Operations

| Feature                                                            | What you get                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [Push instead of poll](/guide/events)                              | UPnP events carried on the LAN, with a return to polling when they stop                       |
| [Alerts](/guide/notifications)                                     | A webhook or an ntfy topic, one message as a rule appears, then silence for an hour           |
| [Key or forward auth](/guide/configuration#behind-a-reverse-proxy) | A bearer key for scripts and agents, or the identity a reverse proxy leaves behind            |
| [Agents, over MCP](/guide/mcp)                                     | Four read and control tools for an MCP client, with no state of its own                       |
| [A small HTTP API](/reference/http-api)                            | State, report, services, settings, command, discover, art, hosts and health                   |
| [Demo mode](/guide/demo)                                           | Three simulated speakers behind the same interface, which is what the end to end suite drives |

## Deliberate limits

- The vendor app stays the reference: the hub reads what a player exposes on the LAN, and nothing
  else.
- Multiroom is read only. A command sent to a member drives its own silent input, so such a card
  offers no transport.
- No runtime dependency, no database, no cloud: one process and the files it is given. See
  [ADR 0001](/adr/0001-zero-runtime-dependencies).
