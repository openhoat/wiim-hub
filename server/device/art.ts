import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { resolveTarget } from './resolve.ts'
import { type Scheme, transportOf } from './transport.ts'

type Binary = { body: Buffer; type: string }

// A cover is a few hundred kilobytes on every player seen so far; the cap is
// what keeps a misbehaving host from filling the process memory through the
// relay, not a claim about real artwork size.
const maxArtBytes = 6 * 1024 * 1024

const privateIpv4 = (address: string): boolean => {
  const [a, b] = address.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

const privateIpv6 = (address: string): boolean => {
  const value = address.toLowerCase()
  if (value === '::' || value === '::1') return true
  // An IPv4-mapped address reaches the same machine: the URL parser rewrites
  // `::ffff:192.168.1.10` to `::ffff:c0a8:10a`, so decode both spellings.
  const mapped = /^::ffff:(.+)$/.exec(value)
  if (mapped !== null) {
    const rest = mapped[1]
    if (rest.includes('.')) return privateIpv4(rest)
    const [high, low] = rest.split(':').map(group => Number.parseInt(group, 16))
    if (Number.isFinite(high) && Number.isFinite(low)) {
      return privateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff].join('.'))
    }
  }
  return /^(fc|fd|fe[89ab]|ff)/.test(value)
}

// Loopback, private, link-local, carrier NAT, multicast and reserved: none of
// those is a cover host. The speaker itself is the one allowed private target,
// and its address is the one the hub already polls.
const privateAddress = (address: string): boolean =>
  address.includes(':') ? privateIpv6(address) : privateIpv4(address)

// Resolve once and connect to the address that was checked: a name that answers
// a public address during the guard and a private one at connect time is the
// oldest trick against this kind of check.
const resolveAddresses = async (hostname: string): Promise<string[] | null> => {
  if (isIP(hostname) !== 0) return [hostname]
  try {
    const found = await lookup(hostname, { all: true, verbatim: true })
    return found.length === 0 ? null : found.map(entry => entry.address)
  } catch {
    return null
  }
}

// The bytes decide, not the header: a streaming host answers
// `application/octet-stream` for a JPEG more often than not, and a text or HTML
// body must never reach the browser as an image.
const sniffArtType = (body: Buffer): string | null => {
  if (body.length < 12) return null
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg'
  if (body.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
  if (
    body.subarray(0, 4).toString('latin1') === 'RIFF' &&
    body.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (
    body[0] === 0x89 &&
    body.subarray(1, 4).toString('latin1') === 'PNG' &&
    body[4] === 0x0d &&
    body[5] === 0x0a
  ) {
    return 'image/png'
  }
  return null
}

type BinaryOptions = { port?: number; insecure?: boolean; serverName?: string }

const getBinary = (
  ip: string,
  path: string,
  scheme: Scheme,
  { port, insecure = false, serverName }: BinaryOptions = {}
): Promise<Binary | null> =>
  new Promise(resolve => {
    const sender = scheme === 'https' ? httpsRequest : httpRequest
    const options = {
      host: ip,
      port: port ?? (scheme === 'https' ? 443 : 80),
      path,
      method: 'GET',
      timeout: 5000,
      // The connection goes to the address that was checked; the name the host
      // expects still decides the Host header and the certificate.
      headers:
        serverName === undefined ? { accept: 'image/*' } : { accept: 'image/*', host: serverName },
      ...(serverName === undefined ? {} : { servername: serverName }),
      ...(scheme === 'https' && insecure ? { rejectUnauthorized: false } : {}),
    }
    const req = sender(options, res => {
      if (res.statusCode !== 200) {
        res.resume()
        resolve(null)
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxArtBytes) {
          req.destroy()
          resolve(null)
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        const body = Buffer.concat(chunks)
        const type = sniffArtType(body)
        resolve(type === null ? null : { body, type })
      })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
    req.end()
  })

// Album art reaches the browser through the hub, for two reasons: an https
// page cannot load the speaker's plain http cover (mixed content), and a
// streaming service sometimes hands out a URL that only resolves from the
// local network. The uri is only ever the one the device reported, which the
// route checks before calling here: this is not an open proxy.
export const fetchAlbumArt = async (host: string, uri: string): Promise<Binary | null> => {
  const deviceIp = resolveTarget(host)
  let target = deviceIp
  let port: number | undefined
  let path = uri
  let scheme: Scheme = transportOf(deviceIp) ?? 'https'
  try {
    const parsed = new URL(uri)
    target = parsed.hostname.replace(/^\[|\]$/g, '')
    port = parsed.port === '' ? undefined : Number(parsed.port)
    path = `${parsed.pathname}${parsed.search}`
    scheme = parsed.protocol === 'http:' ? 'http' : 'https'
  } catch {
    if (!path.startsWith('/')) path = `/${path}`
  }
  // A self-signed certificate is expected on the speaker, never on a public
  // artwork host. A cover hosted by another machine on the local network is
  // refused: the speaker is the one private target the relay accepts.
  const addresses = await resolveAddresses(target)
  if (addresses === null) {
    console.warn(`wiim-hub: art refused, ${target} does not resolve`)
    return null
  }
  const onDevice = target === deviceIp || addresses.includes(deviceIp)
  if (!onDevice && addresses.some(entry => privateAddress(entry))) {
    console.warn(`wiim-hub: art refused, ${target} is not a public address`)
    return null
  }
  const address = onDevice
    ? deviceIp
    : (addresses.find(entry => entry.includes('.')) ?? addresses[0])
  // An address literal is its own Host header: naming it as a TLS server would
  // only trip the RFC 6066 warning.
  const serverName = onDevice || isIP(target) !== 0 ? undefined : target
  const options: BinaryOptions = {
    port,
    insecure: onDevice,
    ...(serverName === undefined ? {} : { serverName }),
  }
  const first = await getBinary(address, path, scheme, options)
  if (first !== null) return first
  return getBinary(address, path, scheme === 'https' ? 'http' : 'https', options)
}
