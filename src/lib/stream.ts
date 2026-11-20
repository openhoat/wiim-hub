import type { HubState } from './types'

// The fleet arrives as a stream of server-sent events (`/api/events`), with the
// poll kept behind it: this module is the reader half, and it knows nothing
// about React. The server side lives in `server/stream.ts`; both share the
// frame syntax of the spec and the body of `/api/state`.

export type StreamFrame = { event: string; data: string }

// `EventSource` would be the obvious choice and is the wrong one: it cannot send
// an `Authorization` header, so a hub guarded by `WIIM_HUB_TOKEN` would refuse
// it, and its reconnect policy is a black box. A plain `fetch` body reader keeps
// the credential story identical to the rest of the API and lets the caller
// decide how long to wait before trying again.

const newline = /\r\n|\r/g

// One frame at a time, out of chunks that can split anywhere: `event:` names it,
// `data:` lines are joined, a blank line ends it, and a line starting with a
// colon is a comment (the heartbeat). Line breaks may be LF, CRLF or CR.
export const createFrameParser = (): { push: (chunk: string) => StreamFrame[] } => {
  let buffer = ''
  let pendingCr = ''
  return {
    push: chunk => {
      let text = pendingCr + chunk
      pendingCr = ''
      // A CR at the end of a chunk may be the first half of a CRLF: holding it
      // back is what keeps a split pair from counting as two breaks.
      if (text.endsWith('\r')) {
        pendingCr = '\r'
        text = text.slice(0, -1)
      }
      buffer += text.replace(newline, '\n')
      const frames: StreamFrame[] = []
      for (;;) {
        const end = buffer.indexOf('\n\n')
        if (end === -1) return frames
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const frame = readBlock(block)
        if (frame !== null) frames.push(frame)
      }
    },
  }
}

const readBlock = (block: string): StreamFrame | null => {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    // One space after the colon is part of the syntax, not of the value.
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  // A block with no data is a comment block: the heartbeat, which carries no
  // fleet and must not be read as one.
  return data.length === 0 ? null : { event, data: data.join('\n') }
}

const isHubState = (value: unknown): value is HubState => {
  if (typeof value !== 'object' || value === null) return false
  if (!('devices' in value) || !Array.isArray(value.devices)) return false
  if (!('ts' in value) || typeof value.ts !== 'number') return false
  return 'pollMs' in value && typeof value.pollMs === 'number'
}

export const stateFromFrame = (frame: StreamFrame): HubState | null => {
  if (frame.event !== 'state') return null
  try {
    const parsed: unknown = JSON.parse(frame.data)
    return isHubState(parsed) ? parsed : null
  } catch {
    return null
  }
}

// A stream that never answered is a route this installation does not serve, or
// an ingress that buffers a response until it ends: both are permanent from the
// reader's side, and retrying them would only delay the poll.
export type StreamOutcome = 'closed' | 'unsupported'

export const streamPath = '/api/events'
// How long a stream may stay silent before the reader gives up on it. A healthy
// one answers at the first tick, and a buffering proxy answers nothing at all.
export const firstEventMs = 5000

export const readStateStream = async (options: {
  signal: AbortSignal
  onState: (state: HubState) => void
  path?: string
  timeoutMs?: number
}): Promise<StreamOutcome> => {
  const { signal, onState, path = streamPath, timeoutMs = firstEventMs } = options
  const control = new AbortController()
  // The caller's signal is the life of the page; this one is the life of the
  // response, and it also carries the timeout below.
  const relay = (): void => control.abort()
  signal.addEventListener('abort', relay, { once: true })
  let timedOut = false
  let live = false
  const timer = setTimeout(() => {
    timedOut = true
    control.abort()
  }, timeoutMs)
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  try {
    const response = await fetch(path, {
      cache: 'no-store',
      headers: { accept: 'text/event-stream' },
      signal: control.signal,
    })
    if (!response.ok || response.body === null) return 'unsupported'
    reader = response.body.getReader()
    const decoder = new TextDecoder()
    const parser = createFrameParser()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
        const state = stateFromFrame(frame)
        if (state === null) continue
        if (!live) {
          live = true
          clearTimeout(timer)
        }
        onState(state)
      }
    }
    return 'closed'
  } catch {
    // A stream that broke after it delivered a fleet is a connection to renew;
    // one that never did was never a stream here.
    return live && !timedOut ? 'closed' : 'unsupported'
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', relay)
    // Releasing the body also unblocks a read left pending when the caller
    // stopped listening.
    reader?.cancel().catch(() => {
      /* the response is gone already */
    })
  }
}
