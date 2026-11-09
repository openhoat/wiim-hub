import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { type AddressInfo, createServer as createNetServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createEventHub,
  type EventPatch,
  eventState,
  parseDuration,
  parseLastChange,
  transportStatus,
} from './upnp.ts'

// The bodies below are the shapes the reference player really sends: a
// `propertyset` whose last change is an escaped `Event`, with the track
// metadata escaped one level further because it sits inside an attribute.

const encodeEntities = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const propertySet = (event: string): string =>
  `<?xml version="1.0"?><e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0"><e:property><LastChange>${encodeEntities(event)}</LastChange></e:property></e:propertyset>`

const avTransportBody = (input: {
  state: string
  duration: string
  title: string
  artist: string
  album: string
  art: string
}): string => {
  const didl =
    '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    `<item><dc:title>${input.title}</dc:title><upnp:artist>${input.artist}</upnp:artist>` +
    `<upnp:album>${input.album}</upnp:album><upnp:albumArtURI>${input.art}</upnp:albumArtURI></item></DIDL-Lite>`
  return propertySet(
    '<Event xmlns="urn:schemas-upnp-org:metadata-1-0/AVT/"><InstanceID val="0">' +
      `<TransportState val="${input.state}"/><TransportStatus val="OK"/><NumberOfTracks val="1"/>` +
      `<CurrentTrackDuration val="${input.duration}"/>` +
      `<CurrentTrackMetaData val="${encodeEntities(didl)}"/></InstanceID></Event>`
  )
}

const renderingBody = (input: { volume: number; mute: boolean }): string =>
  propertySet(
    '<Event xmlns="urn:schemas-upnp-org:metadata-1-0/RCS/"><InstanceID val="0">' +
      `<Volume channel="Master" val="${input.volume}"/><Mute channel="Master" val="${input.mute ? '1' : '0'}"/></InstanceID></Event>`
  )

const description = `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>Salon</friendlyName><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><serviceId>urn:upnp-org:serviceId:AVTransport</serviceId><controlURL>/upnp/control/rendertransport1</controlURL><eventSubURL>/upnp/event/rendertransport1</eventSubURL><SCPDURL>/upnp/rendertransportSCPD.xml</SCPDURL></service>
<service><serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType><serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId><controlURL>/upnp/control/renderconnmgr1</controlURL><eventSubURL>/upnp/event/renderconnmgr1</eventSubURL><SCPDURL>/upnp/renderconnmgrSCPD.xml</SCPDURL></service>
<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId><controlURL>/upnp/control/rendercontrol1</controlURL><eventSubURL>/upnp/event/rendercontrol1</eventSubURL><SCPDURL>/upnp/rendercontrolSCPD.xml</SCPDURL></service>
</serviceList></device></root>`

type FakeDevice = {
  port: number
  calls: Array<{ method: string; path: string; sid: string | null }>
  // SIDs handed out, in subscription order: the test compares them with the
  // ones the hub sends back on renewal.
  issued: string[]
  // The callback URLs the hub asked for, so a test can address the listener
  // without knowing the token it minted.
  callbacks: string[]
  notify: (body: string, options: { seq: number; sid?: string }) => Promise<number>
  close: () => Promise<void>
}

// A player that only does what was measured: it serves its description,
// answers SUBSCRIBE with a SID, renews on the same SID, and accepts
// UNSUBSCRIBE. The test drives the notifications so it can choose the moment.
const startFakeDevice = async (
  options: {
    refuseSubscribe?: boolean
    crashSubscribe?: boolean
    refuseRenew?: boolean
    paths?: { transport: string; control: string }
  } = {}
): Promise<FakeDevice> => {
  const calls: FakeDevice['calls'] = []
  const issued: string[] = []
  const callbacks: string[] = []
  const subscriptions = new Map<string, string>()
  const advertised = description
    .replace(
      '/upnp/event/rendertransport1',
      options.paths?.transport ?? '/upnp/event/rendertransport1'
    )
    .replace('/upnp/event/rendercontrol1', options.paths?.control ?? '/upnp/event/rendercontrol1')
  const server: Server = createServer((req, res) => {
    const method = req.method ?? ''
    const path = req.url ?? ''
    calls.push({ method, path, sid: (req.headers.sid as string | undefined) ?? null })
    if (path === '/description.xml') {
      res.writeHead(200, { 'content-type': 'text/xml' })
      res.end(advertised)
      return
    }
    // A device that disappears mid-subscription: the hub has to read that as a
    // refusal, not as a subscription it can use.
    if (method === 'SUBSCRIBE' && options.crashSubscribe === true) {
      req.destroy()
      return
    }
    // A device that answers the first subscription and then refuses to extend
    // it: the SID is about to expire, so polling has to take over.
    if (method === 'SUBSCRIBE' && options.refuseRenew === true && req.headers.sid !== undefined) {
      res.writeHead(500)
      res.end()
      return
    }
    if (method === 'SUBSCRIBE' && options.refuseSubscribe !== true) {
      const renew = typeof req.headers.sid === 'string'
      const sid = renew ? (req.headers.sid as string) : `uuid:${randomUUID()}`
      if (!renew) issued.push(sid)
      const callback = (req.headers.callback as string | undefined)
        ?.replace(/^</, '')
        .replace(/>$/, '')
      if (callback !== undefined) {
        subscriptions.set(sid, callback)
        callbacks.push(callback)
      }
      res.writeHead(200, { sid, timeout: 'Second-1' })
      res.end()
      return
    }
    if (method === 'UNSUBSCRIBE') {
      res.writeHead(200)
      res.end()
      return
    }
    res.writeHead(options.refuseSubscribe === true ? 500 : 404)
    res.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    calls,
    issued,
    callbacks,
    notify: async (body, input) => {
      const sid = input.sid ?? [...subscriptions.keys()][0]
      const callback = subscriptions.get(sid)
      if (callback === undefined) throw new Error('no subscription to notify')
      const response = await fetch(callback, {
        method: 'NOTIFY',
        headers: {
          'content-type': 'text/xml',
          NT: 'upnp:event',
          NTS: 'upnp:propchange',
          SID: sid,
          SEQ: String(input.seq),
        },
        body,
      })
      return response.status
    },
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

// The callback base has to name the port before the hub starts, so the port is
// borrowed from the OS first: a test cannot use port 0 for both.
const freePort = async (): Promise<number> => {
  const probe = createNetServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  return port
}

const waitFor = async (condition: () => boolean, timeoutMs = 2000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('parseDuration', () => {
  it('reads the measured HH:MM:SS form, with an optional fraction', () => {
    expect(parseDuration('00:00:00')).toBe(0)
    expect(parseDuration('00:05:37')).toBe(337_000)
    expect(parseDuration('01:02:03')).toBe(3_723_000)
    expect(parseDuration('01:02:03.500')).toBe(3_723_500)
    expect(parseDuration('  00:00:42  ')).toBe(42_000)
  })

  it('refuses anything else instead of guessing', () => {
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('NOT_IMPLEMENTED')).toBeNull()
    expect(parseDuration('00:99:00')).toBeNull()
    expect(parseDuration('-1:00:00')).toBeNull()
  })
})

describe('transportStatus', () => {
  it('maps the UPnP wording onto the hub tokens', () => {
    expect(transportStatus('PLAYING')).toBe('play')
    expect(transportStatus('PAUSED_PLAYBACK')).toBe('pause')
    expect(transportStatus('PAUSED_RECORDING')).toBe('pause')
    expect(transportStatus('STOPPED')).toBe('stop')
    expect(transportStatus('NO_MEDIA_PRESENT')).toBe('stop')
    expect(transportStatus(' playing ')).toBe('play')
  })

  it('leaves a transient state to the next poll', () => {
    expect(transportStatus('TRANSITIONING')).toBeNull()
    expect(transportStatus('')).toBeNull()
  })
})

describe('parseLastChange', () => {
  it('reads volume and mute from a rendering notification', () => {
    expect(parseLastChange(renderingBody({ volume: 82, mute: false }))).toEqual({
      volume: 82,
      mute: false,
    })
    expect(parseLastChange(renderingBody({ volume: 44, mute: true }))).toEqual({
      volume: 44,
      mute: true,
    })
  })

  it('reads the transport state, the duration and the track metadata', () => {
    const patch = parseLastChange(
      avTransportBody({
        state: 'PLAYING',
        duration: '00:05:37',
        title: 'Blue in Green',
        artist: 'Miles Davis',
        album: 'Kind of Blue',
        art: 'http://192.168.1.150:8200/art.jpg',
      })
    )
    expect(patch).toEqual({
      status: 'play',
      totalMs: 337_000,
      title: 'Blue in Green',
      artist: 'Miles Davis',
      album: 'Kind of Blue',
      albumArt: 'http://192.168.1.150:8200/art.jpg',
    })
  })

  it('drops what the device leaves empty and keeps the rest of the patch', () => {
    // An input with no media: the player still sends a transport state and a
    // zero duration, and `CurrentTrackMetaData` carries nothing usable.
    const body = propertySet(
      '<Event xmlns="urn:schemas-upnp-org:metadata-1-0/AVT/"><InstanceID val="0">' +
        '<TransportState val="STOPPED"/><CurrentTrackDuration val="00:00:00"/>' +
        '<CurrentTrackMetaData val=""></InstanceID></Event>'
    )
    expect(parseLastChange(body)).toEqual({ status: 'stop', totalMs: 0 })
  })

  it('returns nothing when the notification carries no known field', () => {
    expect(parseLastChange(propertySet('<Event><InstanceID val="0"/></Event>'))).toEqual({})
    expect(parseLastChange('not xml at all')).toEqual({})
  })
})

describe('eventState', () => {
  it('reports off, subscribed and degraded', () => {
    expect(eventState({ subscribed: false, misses: 0 })).toBe('off')
    expect(eventState({ subscribed: true, misses: 0 })).toBe('subscribed')
    expect(eventState({ subscribed: true, misses: 1 })).toBe('subscribed')
    expect(eventState({ subscribed: true, misses: 2 })).toBe('degraded')
    expect(eventState({ subscribed: false, misses: 2 })).toBe('degraded')
  })
})

describe('createEventHub', () => {
  let hub: ReturnType<typeof createEventHub> | null = null
  let device: FakeDevice | null = null

  afterEach(async () => {
    await hub?.close()
    hub = null
    await device?.close()
    device = null
  })

  it('subscribes to both services, applies a notification and releases the subscription', async () => {
    device = await startFakeDevice()
    const port = await freePort()
    const patches: Array<{ ip: string; patch: EventPatch }> = []
    hub = createEventHub({
      port,
      devicePort: device.port,
      callbackBase: `http://127.0.0.1:${port}`,
      onPatch: (ip, patch) => patches.push({ ip, patch }),
      timeoutSeconds: 1,
      // Keep the renewal out of this case: it has its own test.
      renewRatio: 0.9,
    })
    await hub.start()

    expect(hub.status('127.0.0.1')).toEqual({
      state: 'off',
      lastEventAt: null,
      events: 0,
      misses: 0,
    })

    await expect(hub.subscribe('127.0.0.1')).resolves.toBe(true)
    expect(hub.isSubscribed('127.0.0.1')).toBe(true)
    expect(hub.status('127.0.0.1').state).toBe('subscribed')

    // The description is read once, the measured defaults only answer for a
    // device that advertises nothing.
    expect(device.calls[0]).toMatchObject({ method: 'GET', path: '/description.xml' })
    const subscribed = device.calls.filter(call => call.method === 'SUBSCRIBE')
    expect(subscribed.map(call => call.path)).toEqual([
      '/upnp/event/rendertransport1',
      '/upnp/event/rendercontrol1',
    ])

    await expect(
      device.notify(renderingBody({ volume: 55, mute: true }), { seq: 0 })
    ).resolves.toBe(200)
    expect(patches).toEqual([{ ip: '127.0.0.1', patch: { volume: 55, mute: true } }])
    expect(hub.status('127.0.0.1')).toMatchObject({ state: 'subscribed', events: 1, misses: 0 })

    // A notification that arrives out of order is acknowledged and dropped:
    // the state it carries is older than the one already applied.
    await expect(
      device.notify(renderingBody({ volume: 12, mute: false }), { seq: 0 })
    ).resolves.toBe(200)
    expect(patches).toHaveLength(1)

    hub.unsubscribe('127.0.0.1')
    expect(hub.isSubscribed('127.0.0.1')).toBe(false)
    await waitFor(() => device?.calls.filter(call => call.method === 'UNSUBSCRIBE').length === 2)
  })

  it('renews on the same SID before the granted timeout expires', async () => {
    device = await startFakeDevice()
    const port = await freePort()
    hub = createEventHub({
      port,
      devicePort: device.port,
      callbackBase: `http://127.0.0.1:${port}`,
      onPatch: () => undefined,
      timeoutSeconds: 1,
      renewRatio: 0.05,
    })
    await hub.start()
    await hub.subscribe('127.0.0.1')
    const sids = [...device.issued]

    await waitFor(
      () => (device?.calls.filter(call => call.method === 'SUBSCRIBE').length ?? 0) >= 4
    )
    const renewals = device.calls.filter(call => call.method === 'SUBSCRIBE').slice(2, 4)
    // A renewal is the same SID sent back: opening a second subscription would
    // leave the first one to expire on its own.
    expect(renewals.map(call => call.sid)).toEqual([sids[0], sids[1]])
    expect(hub.isSubscribed('127.0.0.1')).toBe(true)
  })

  it('falls back to polling when the device refuses the subscription', async () => {
    device = await startFakeDevice({ refuseSubscribe: true })
    const port = await freePort()
    hub = createEventHub({
      port,
      devicePort: device.port,
      callbackBase: `http://127.0.0.1:${port}`,
      onPatch: () => undefined,
    })
    await hub.start()

    await expect(hub.subscribe('127.0.0.1')).resolves.toBe(false)
    expect(hub.isSubscribed('127.0.0.1')).toBe(false)
    expect(hub.status('127.0.0.1').state).toBe('off')
  })

  it('falls back to polling when the subscription connection breaks', async () => {
    // A device that answers the description and then drops the SUBSCRIBE: the
    // hub must not keep a half-open entry it would renew forever.
    device = await startFakeDevice({ crashSubscribe: true })
    const port = await freePort()
    hub = createEventHub({
      port,
      devicePort: device.port,
      callbackBase: `http://127.0.0.1:${port}`,
      onPatch: () => undefined,
    })
    await hub.start()

    await expect(hub.subscribe('127.0.0.1')).resolves.toBe(false)
    expect(hub.isSubscribed('127.0.0.1')).toBe(false)
    expect(hub.status('127.0.0.1')).toMatchObject({ state: 'off', misses: 0 })
  })

  it('degrades when the device refuses to renew the subscription', async () => {
    device = await startFakeDevice({ refuseRenew: true })
    const port = await freePort()
    hub = createEventHub({
      port,
      devicePort: device.port,
      callbackBase: `http://127.0.0.1:${port}`,
      onPatch: () => undefined,
      timeoutSeconds: 1,
      renewRatio: 0.05,
    })
    await hub.start()
    await expect(hub.subscribe('127.0.0.1')).resolves.toBe(true)

    // The SID is about to expire and the device will not extend it: the fast
    // channel is over, so the status has to say `degraded` before the poll
    // actually takes over.
    await waitFor(() => hub?.status('127.0.0.1').state === 'degraded')
    expect(hub.isSubscribed('127.0.0.1')).toBe(false)
    expect(hub.status('127.0.0.1').misses).toBe(2)
  })

  it('reads the event paths the device advertises instead of the measured defaults', async () => {
    // A firmware that moves its endpoints: the description is the contract.
    device = await startFakeDevice({
      paths: { transport: '/evt/transport', control: '/evt/control' },
    })
    const port = await freePort()
    hub = createEventHub({
      port,
      devicePort: device.port,
      callbackBase: `http://127.0.0.1:${port}`,
      onPatch: () => undefined,
    })
    await hub.start()

    await expect(hub.subscribe('127.0.0.1')).resolves.toBe(true)
    expect(device.calls.filter(call => call.method === 'SUBSCRIBE').map(call => call.path)).toEqual(
      ['/evt/transport', '/evt/control']
    )
  })

  it('degrades after two contradicting polls and comes back on a new subscription', async () => {
    device = await startFakeDevice()
    const port = await freePort()
    hub = createEventHub({
      port,
      devicePort: device.port,
      callbackBase: `http://127.0.0.1:${port}`,
      onPatch: () => undefined,
      timeoutSeconds: 30,
    })
    await hub.start()
    await hub.subscribe('127.0.0.1')

    hub.markMiss('127.0.0.1')
    expect(hub.status('127.0.0.1').state).toBe('subscribed')
    hub.markMiss('127.0.0.1')
    // The entry stays so the page can say why the fast poll is back.
    expect(hub.isSubscribed('127.0.0.1')).toBe(false)
    expect(hub.status('127.0.0.1')).toMatchObject({ state: 'degraded', misses: 2 })

    // A late notification cannot refresh a channel the hub stopped trusting.
    hub.clearMiss('127.0.0.1')
    expect(hub.status('127.0.0.1').misses).toBe(0)

    await expect(hub.subscribe('127.0.0.1')).resolves.toBe(true)
    expect(hub.status('127.0.0.1')).toMatchObject({ state: 'subscribed', misses: 0 })
  })

  it('answers every notification it cannot attribute with a 404', async () => {
    device = await startFakeDevice()
    const port = await freePort()
    const patches: EventPatch[] = []
    hub = createEventHub({
      port,
      devicePort: device.port,
      callbackBase: `http://127.0.0.1:${port}`,
      onPatch: (_ip, patch) => patches.push(patch),
    })
    await hub.start()

    // No subscription yet: the token is unknown.
    const fresh = await fetch(`http://127.0.0.1:${port}/upnp/deadbeef`, {
      method: 'NOTIFY',
      headers: { SID: 'uuid:x', SEQ: '0' },
      body: renderingBody({ volume: 10, mute: false }),
    })
    expect(fresh.status).toBe(404)
    expect(patches).toHaveLength(0)

    // The listener serves no other verb and no other path.
    const probe = await fetch(`http://127.0.0.1:${port}/upnp/deadbeef`)
    expect(probe.status).toBe(404)
  })

  it('refuses a notification that carries no SID', async () => {
    device = await startFakeDevice()
    const port = await freePort()
    const patches: EventPatch[] = []
    hub = createEventHub({
      port,
      devicePort: device.port,
      callbackBase: `http://127.0.0.1:${port}`,
      onPatch: (_ip, patch) => patches.push(patch),
    })
    await hub.start()
    await expect(hub.subscribe('127.0.0.1')).resolves.toBe(true)

    // The token and the source address say who is talking, not which
    // subscription: without a SID the sequence number would be kept for none.
    const response = await fetch(device.callbacks[0], {
      method: 'NOTIFY',
      headers: { 'content-type': 'text/xml', SEQ: '0' },
      body: renderingBody({ volume: 20, mute: false }),
    })
    expect(response.status).toBe(412)
    expect(patches).toHaveLength(0)
  })

  it('drops a notification larger than the limit instead of buffering it', async () => {
    device = await startFakeDevice()
    const port = await freePort()
    const patches: EventPatch[] = []
    hub = createEventHub({
      port,
      devicePort: device.port,
      callbackBase: `http://127.0.0.1:${port}`,
      onPatch: (_ip, patch) => patches.push(patch),
    })
    await hub.start()
    await expect(hub.subscribe('127.0.0.1')).resolves.toBe(true)

    // A player that sends more than 64 KiB is not sending a state change: the
    // request is cut rather than buffered, so the hub cannot be made to hold an
    // arbitrary body.
    const oversized = await fetch(device.callbacks[0], {
      method: 'NOTIFY',
      headers: {
        'content-type': 'text/xml',
        SID: device.issued[0],
        SEQ: '1',
      },
      body: 'x'.repeat(100 * 1024),
    }).then(
      () => 'answered',
      () => 'cut'
    )
    expect(oversized).toBe('cut')
    expect(patches).toHaveLength(0)
  })

  it('closes twice, because a shutdown can reach it twice', async () => {
    device = await startFakeDevice()
    const port = await freePort()
    hub = createEventHub({
      port,
      devicePort: device.port,
      callbackBase: `http://127.0.0.1:${port}`,
      onPatch: () => undefined,
    })
    await hub.start()
    await hub.close()
    await expect(hub.close()).resolves.toBeUndefined()
    hub = null
  })
})
