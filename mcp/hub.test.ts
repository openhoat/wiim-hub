import { createServer, type IncomingMessage, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createHub, errorText, okText } from './hub.ts'

// The client is exercised on the wire, against a socket, rather than against a
// stubbed fetch: the failure modes worth testing (a proxy page, an empty body,
// a refused port) are decided while reading a real response.

type Received = { method: string; url: string; headers: IncomingMessage['headers']; body: string }

const servers: Server[] = []

const listen = async (
  handler: (req: IncomingMessage, res: import('node:http').ServerResponse, body: string) => void,
  { received }: { received: Received[] } = { received: [] }
): Promise<string> => {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => {
      body += String(chunk)
    })
    req.on('end', () => {
      received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body })
      handler(req, res, body)
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no address')
  return `http://127.0.0.1:${address.port}`
}

const json = (status: number, payload: unknown) => {
  return (_req: IncomingMessage, res: import('node:http').ServerResponse): void => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>(resolve => {
      server.close(() => resolve())
    })
  }
})

describe('createHub', () => {
  it('builds the path with the query and keeps the answer', async () => {
    const received: Received[] = []
    const baseUrl = await listen(json(200, { devices: [] }), { received })
    const hub = createHub({ baseUrl, token: 'secret' })
    const entry = await hub.get('/api/report', { host: 'kitchen' })
    expect(entry).toEqual({ status: 200, ok: true, body: { devices: [] } })
    expect(received[0].method).toBe('GET')
    expect(received[0].url).toBe('/api/report?host=kitchen')
    // The hub has no authentication: the header is for the ingress in front.
    expect(received[0].headers.authorization).toBe('Bearer secret')
    expect(received[0].headers.accept).toBe('application/json')
    expect(received[0].headers.authorization).not.toBeUndefined()
  })

  it('strips the slashes a base url may end on, and refuses a url with no scheme', async () => {
    const received: Received[] = []
    const baseUrl = await listen(json(200, {}), { received })
    await createHub({ baseUrl: `${baseUrl}///` }).get('/api/state')
    expect(received[0].url).toBe('/api/state')
    expect(() => createHub({ baseUrl: 'hub.local:8090' })).toThrow(/http/)
  })

  it('sends no authorization header without a token', async () => {
    const received: Received[] = []
    const baseUrl = await listen(json(200, {}), { received })
    await createHub({ baseUrl }).get('/api/state')
    expect(received[0].headers).not.toHaveProperty('authorization')
  })

  it('keeps a refusal as an answer, status and body included', async () => {
    const baseUrl = await listen(json(404, { error: 'unknown device' }))
    const entry = await createHub({ baseUrl }).get('/api/report', { host: 'nope' })
    expect(entry).toEqual({ status: 404, ok: false, body: { error: 'unknown device' } })
  })

  it('turns a proxy page into a short error rather than a parse failure', async () => {
    const baseUrl = await listen((_req, res) => {
      res.writeHead(401, { 'content-type': 'text/html' })
      res.end('<html>\n  <body>Please sign in to continue</body>\n</html>')
    })
    const entry = await createHub({ baseUrl }).get('/api/state')
    expect(entry).toEqual({
      status: 401,
      ok: false,
      body: { error: '<html>\n  <body>Please sign in to continue</body>\n</html>' },
    })
  })

  it('reads an empty answer as null', async () => {
    const baseUrl = await listen((_req, res) => {
      res.writeHead(204)
      res.end()
    })
    const entry = await createHub({ baseUrl }).get('/api/state')
    expect(entry).toEqual({ status: 204, ok: true, body: null })
  })

  it('posts the intent as JSON', async () => {
    const received: Received[] = []
    const baseUrl = await listen(json(200, { ok: true, command: 'setPlayerCmd:resume' }), {
      received,
    })
    const hub = createHub({ baseUrl })
    const entry = await hub.post(
      '/api/command',
      { host: 'kitchen' },
      { action: 'volume', level: 30 }
    )
    expect(entry.body).toEqual({ ok: true, command: 'setPlayerCmd:resume' })
    expect(received[0].method).toBe('POST')
    expect(received[0].url).toBe('/api/command?host=kitchen')
    expect(received[0].headers['content-type']).toBe('application/json')
    expect(JSON.parse(received[0].body)).toEqual({ action: 'volume', level: 30 })
  })

  it('answers a refused port instead of throwing', async () => {
    // Bound then closed: the port is known to be free, and connecting to it is
    // refused rather than hanging.
    const server = createServer()
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    await new Promise<void>(resolve => {
      server.close(() => resolve())
    })
    if (address === null || typeof address === 'string') throw new Error('no address')
    const entry = await createHub({ baseUrl: `http://127.0.0.1:${address.port}` }).get('/api/state')
    expect(entry.status).toBe(0)
    expect(entry.ok).toBe(false)
    expect(JSON.stringify(entry.body)).toContain('hub unreachable')
  })

  it('gives up on a hub that never answers', async () => {
    const baseUrl = await listen(() => {
      // Never writes: the socket stays open until the client aborts.
    })
    const entry = await createHub({ baseUrl, timeoutMs: 50 }).get('/api/state')
    expect(entry.status).toBe(0)
    expect(JSON.stringify(entry.body)).toContain('timed out')
  })

  it('refuses a URL without a scheme', () => {
    expect(() => createHub({ baseUrl: '192.168.1.10:8090' })).toThrow(/must start with http/)
  })
})

describe('answer rendering', () => {
  it('passes a successful body through unchanged', () => {
    expect(okText({ status: 200, ok: true, body: { a: 1 } })).toBe('{\n  "a": 1\n}')
  })

  it('adds the status to a hub error and leaves the rest alone', () => {
    expect(errorText({ status: 409, ok: false, body: { error: 'device offline' } })).toBe(
      '{\n  "status": 409,\n  "error": "device offline"\n}'
    )
    // A body that is not an object is kept under its own key rather than
    // spread, which would drop it.
    expect(errorText({ status: 0, ok: false, body: 'boom' })).toBe(
      '{\n  "status": 0,\n  "body": "boom"\n}'
    )
  })
})
