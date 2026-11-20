import { request as httpRequest } from 'node:http'

// The one write the hub addresses to a speaker's UPnP control port instead of
// its LinkPlay API, and why: the LinkPlay mute of a group master reaches every
// member (measured 20/11), so a room cannot be muted through it without
// silencing the group. `RenderingControl` answers on the description port in
// plain http, TLS is refused there, and its `SetMute` silences the speaker it is
// addressed to and nobody else. Measured on the Pro (master of three) and on a
// Mini: the members keep `mute=0` and the reading comes back in the LinkPlay
// status, so the poll sees it like any other write.
const port = 49152
const controlPath = '/upnp/control/rendercontrol1'
const service = 'urn:schemas-upnp-org:service:RenderingControl:1'
const timeoutMs = 2500

// The envelope of the one action the hub sends. `Channel` is `Master` because
// the speakers publish a single channel; `InstanceID` 0 is the only instance.
export const muteEnvelope = (muted: boolean): string =>
  `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:SetMute xmlns:u="${service}"><InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>${muted ? 1 : 0}</DesiredMute></u:SetMute></s:Body></s:Envelope>`

// Answers with the SOAP body, or null when the speaker could not be reached:
// the queue turns that into a failed outcome rather than dropping it.
export const setLocalMute = (
  ip: string,
  muted: boolean,
  options: { port?: number } = {}
): Promise<string | null> =>
  new Promise(resolve => {
    const body = muteEnvelope(muted)
    const req = httpRequest(
      {
        host: ip,
        port: options.port ?? port,
        path: controlPath,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'content-type': 'text/xml; charset="utf-8"',
          soapaction: `"${service}#SetMute"`,
          'content-length': Buffer.byteLength(body),
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
    req.end(body)
  })
