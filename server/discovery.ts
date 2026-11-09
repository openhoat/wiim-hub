import { createSocket } from 'node:dgram'
import { request as httpRequest } from 'node:http'

const descriptionTimeoutMs = 1500

const parseHeaders = (response: string): Map<string, string> => {
  const headers = new Map<string, string>()
  for (const line of response.split('\r\n').slice(1)) {
    const index = line.indexOf(':')
    if (index > 0)
      headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim())
  }
  return headers
}

const looksLikeWiim = (body: string): boolean => /wiim|linkplay/i.test(body)

const fetchDescription = (location: string): Promise<string | null> =>
  new Promise(resolve => {
    const req = httpRequest(location, { timeout: descriptionTimeoutMs }, res => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
    req.end()
  })

// Best effort: SSDP multicast does not cross every container network, so the
// device list stays explicit (DEVICE_HOSTS) and discovery only enriches it.
export const discoverSsdp = (timeoutMs = 3000): Promise<string[]> =>
  new Promise(resolve => {
    const found = new Set<string>()
    const pending = new Set<Promise<void>>()
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    const close = (): void => {
      try {
        socket.close()
      } catch {
        // already closed
      }
    }
    const finish = (): void => {
      close()
      void Promise.allSettled([...pending]).then(() => resolve([...found]))
    }
    socket.on('error', () => resolve([]))
    socket.on('message', (buffer, remote) => {
      const headers = parseHeaders(buffer.toString('utf8'))
      const location = headers.get('location')
      if (!location) return
      const task = fetchDescription(location).then(body => {
        if (body && looksLikeWiim(body) && !found.has(remote.address)) found.add(remote.address)
      })
      pending.add(task)
      void task.finally(() => pending.delete(task))
    })
    socket.bind(() => {
      const message = Buffer.from(
        [
          'M-SEARCH * HTTP/1.1',
          'HOST: 239.255.255.250:1900',
          'MAN: "ssdp:discover"',
          'MX: 2',
          'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
          '',
          '',
        ].join('\r\n')
      )
      socket.send(message, 1900, '239.255.255.250', error => {
        if (error) resolve([])
      })
      setTimeout(finish, timeoutMs)
    })
  })
