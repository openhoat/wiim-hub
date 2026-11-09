---
layout: home

hero:
  name: WiiM Hub
  text: A local hub for your speakers
  tagline: What each player is doing, what it reports about itself, and the controls you need when the vendor app is not at hand.
  image:
    src: /logo.svg
    alt: WiiM Hub
  actions:
    - theme: brand
      text: Get started
      link: /guide/quick-start
    - theme: alt
      text: How it works
      link: /how-it-works
    - theme: alt
      text: GitHub
      link: https://github.com/openhoat/wiim-hub

features:
  - title: Two views, one dataset
    details: A now playing view for everyday use, and a diagnostic view that turns the device's own counters into short, evidenced facts you can paste into a support thread.
  - title: Controls, without the app
    details: Transport, volume, seek, presets, sleep timer, audio route, stream URL and device settings, each written through one queue per speaker so a slider drag cannot race itself.
  - title: A mixed fleet is the normal case
    details: Pro, Mini, Amp, Ultra and OEM LinkPlay players side by side. Transport, name resolution and capabilities are probed per device, never assumed.
  - title: No speaker, no problem
    details: A demo mode serves the same interface over two simulated players. The end-to-end suite runs against it, so the project is testable without hardware.
---

## What the hub is

A small self-hosted service that polls the players on your local network every few seconds and
serves one page for all of them. It is a complement to the vendor app, not a replacement for it:
the same device data, on a screen you already have open, in a browser and on a phone.

It ships no vendor code and calls only the HTTP interface the players expose on the LAN. Where a
behaviour was measured on a real player it is recorded in the
[feature research](/feature-research); where it is an inference, the page says so.

## What it looks like

![Now playing, with one speaker online and one offline](img/now-playing.jpeg)

Two views on the same data: the sound card, with a per-source equalizer, and the diagnostic view,
which turns the device's own counters into short facts. Both fit a phone, where the cards stack one
per screen and nothing needs a zoom.

|                                                                           |                                            |
| ------------------------------------------------------------------------- | ------------------------------------------ |
| ![Sound card](img/sound.jpeg)<br>![Diagnostic view](img/diagnostics.jpeg) | ![Now playing on a phone](img/mobile.jpeg) |

The captures come from [the demo](/guide/demo): simulated speakers, invented titles, generated
covers and documentation addresses.

## Where to go next

- [Quick start](/guide/quick-start): run the published image, or build from sources.
- [Configuration](/guide/configuration): the environment variables, and what has to stay reachable.
- [Devices](/guide/devices): an explicit list, discovery, or names kept in sync by mDNS.
- [UPnP events](/guide/events): push instead of poll, and how the hub degrades when it stops.
- [How it works](/how-it-works): the poll loop, the write queue, the findings and the report.

::: warning Independent project
WiiM Hub is not affiliated with, endorsed by or supported by WiiM or LinkPlay Technology. WiiM and
LinkPlay are trademarks of their respective owners, named here to say what the hub works with and
nothing more.
:::
