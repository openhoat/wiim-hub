import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

// The wire: one GET against `httpapi.asp`, on the scheme the device answers.
// Everything above this file speaks in answers, never in sockets, which is what
// makes the parsers testable without a speaker.
export type Scheme = 'https' | 'http'

const transports = new Map<string, Scheme>()
const timeoutMs = 2500

const getOnce = (ip: string, command: string, scheme: Scheme): Promise<string | null> =>
  new Promise(resolve => {
    const sender = scheme === 'https' ? httpsRequest : httpRequest
    const options = {
      host: ip,
      port: scheme === 'https' ? 443 : 80,
      // The equalizer commands carry a JSON argument (quotes, braces, spaces):
      // the device decodes the query string, and an unencoded path with those
      // characters is rejected by the HTTP client before it leaves the hub.
      path: `/httpapi.asp?command=${encodeURIComponent(command)}`,
      method: 'GET',
      timeout: timeoutMs,
      headers: { accept: 'application/json, text/plain, */*' },
      ...(scheme === 'https' ? { rejectUnauthorized: false } : {}),
    }
    const req = sender(options, res => {
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

// Recent firmware moved the local API to https/443; older builds answer on
// http/80. Try the remembered transport first, then the other one, so a mixed
// fleet costs at most one double request per device.
export const fetchCommand = async (ip: string, command: string): Promise<string | null> => {
  const preferred = transports.get(ip) ?? 'https'
  const first = await getOnce(ip, command, preferred)
  if (first !== null) {
    // Remember the transport that answered, including the default one: the
    // report names it, and a device that stops answering on its first scheme
    // is retried on the other one without waiting for a failure.
    transports.set(ip, preferred)
    return first
  }
  const fallback: Scheme = preferred === 'https' ? 'http' : 'https'
  const second = await getOnce(ip, command, fallback)
  if (second !== null) transports.set(ip, fallback)
  return second
}

// The scheme the device answered on, `null` before the first successful call:
// "the hub talks to this address over https" is part of a support report.
export const transportOf = (ip: string): Scheme | null => transports.get(ip) ?? null
