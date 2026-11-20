import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import { muteEnvelope, setLocalMute } from './mute.ts'

// A speaker's RenderingControl, reduced to what the hub sends it: the path, the
// SOAP action and the body, then whatever answer the test decides to give.
type Seen = { path: string; action: string; body: string }

const fake = (answer: (req: Seen) => { status: number; body: string }) => {
  const seen: Seen[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const entry: Seen = {
        path: req.url ?? '',
        action: req.headers.soapaction as string,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      seen.push(entry)
      const { status, body } = answer(entry)
      res.writeHead(status, { 'content-type': 'text/xml; charset="utf-8"' })
      res.end(body)
    })
  })
  return new Promise<{ server: Server; seen: Seen[]; port: number }>(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, seen, port: (server.address() as AddressInfo).port })
    })
  })
}

const servers: Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

describe('muteEnvelope', () => {
  test('addresses the one channel the speakers publish', () => {
    const on = muteEnvelope(true)
    expect(on).toContain('<InstanceID>0</InstanceID>')
    expect(on).toContain('<Channel>Master</Channel>')
    expect(on).toContain('<DesiredMute>1</DesiredMute>')
    expect(muteEnvelope(false)).toContain('<DesiredMute>0</DesiredMute>')
    expect(on).toContain('urn:schemas-upnp-org:service:RenderingControl:1')
  })
})

describe('setLocalMute', () => {
  test('posts SetMute to the rendering control of the speaker it targets', async () => {
    const device = await fake(() => ({
      status: 200,
      body: '<s:Envelope>SetMuteResponse</s:Envelope>',
    }))
    servers.push(device.server)

    const body = await setLocalMute('127.0.0.1', true, { port: device.port })

    expect(body).toContain('SetMuteResponse')
    expect(device.seen).toHaveLength(1)
    expect(device.seen[0].path).toBe('/upnp/control/rendercontrol1')
    expect(device.seen[0].action).toBe('"urn:schemas-upnp-org:service:RenderingControl:1#SetMute"')
    expect(device.seen[0].body).toBe(muteEnvelope(true))
  })

  test('answers null when the speaker is unreachable, so the queue can report it', async () => {
    const device = await fake(() => ({ status: 200, body: '' }))
    const port = device.port
    device.server.close()

    expect(await setLocalMute('127.0.0.1', false, { port })).toBeNull()
  })

  test('hands the SOAP fault back as it came: the reader decides', async () => {
    const fault =
      '<s:Fault><errorCode>501</errorCode><errorDescription>Action Failed</errorDescription></s:Fault>'
    const device = await fake(() => ({ status: 500, body: fault }))
    servers.push(device.server)

    expect(await setLocalMute('127.0.0.1', true, { port: device.port })).toBe(fault)
  })
})
