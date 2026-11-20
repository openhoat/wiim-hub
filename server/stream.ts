// The page reads the fleet as fast as the hub knows it, instead of asking every
// three seconds. Server-sent events are the smallest way to do that: one plain
// HTTP response that never ends, one frame per tick. No WebSocket, because a
// reverse proxy in front of a self-hosted install is free to break the upgrade,
// and no library, because the server runs on Node built-ins only (ADR 0001).
//
// What it is not: a replacement. `/api/state` stays the contract every other
// client uses, and it stays the fallback the page reads when the stream cannot
// start or stops answering. Nothing here decides for the reader.

export type StreamWriter = {
  write: (chunk: string) => boolean
  end: () => void
  // Node answers false from `write` when the socket buffer is full, and 'drain'
  // when it is not. A frame is a whole state, so one in flight per reader is
  // enough: the next tick carries the fresher one anyway.
  once?: (event: 'drain', listener: () => void) => unknown
}

export type StreamRegistry = {
  size: () => number
  // Returns the removal, so a route can hand it to the response lifecycle.
  add: (writer: StreamWriter) => () => void
  push: (chunk: string) => void
  close: () => void
}

// One state per tick, the same payload `/api/state` answers, so a reader has
// one shape to decode whichever way it got the fleet.
export const stateFrame = (payload: unknown): string =>
  `event: state\ndata: ${JSON.stringify(payload)}\n\n`

// A comment line is a frame the browser ignores and a proxy still forwards: an
// idle connection that sees nothing for a minute is what a load balancer and a
// mobile browser drop first.
export const heartbeatFrame = (at: number): string => `: heartbeat ${at}\n\n`

export const streamHeaders: Record<string, string> = {
  'content-type': 'text/event-stream; charset=utf-8',
  // `no-transform` asks an intermediary not to recompress or rewrap the body:
  // both would hold the frames back until enough of them had arrived.
  'cache-control': 'no-store, no-transform',
  connection: 'keep-alive',
  // nginx buffers a proxied response by default, which turns the stream into a
  // batch delivered at the end. It honours this header.
  'x-accel-buffering': 'no',
}

export const createStreamRegistry = (): StreamRegistry => {
  const writers = new Map<StreamWriter, { ready: boolean }>()
  const drop = (writer: StreamWriter): void => {
    writers.delete(writer)
    try {
      writer.end()
    } catch {
      // The peer is gone already: closing it again is not an error worth a log.
    }
  }
  return {
    size: () => writers.size,
    add: writer => {
      writers.set(writer, { ready: true })
      return () => {
        writers.delete(writer)
      }
    },
    // A busy reader skips the frames it cannot take yet instead of being sent
    // the whole backlog: this is a state stream, so only the freshest frame
    // matters. Ending the response on backpressure would drop the connection on
    // the first frame bigger than the socket buffer.
    push: chunk => {
      for (const [writer, entry] of writers) {
        if (!entry.ready) continue
        try {
          if (writer.write(chunk)) continue
          entry.ready = false
          writer.once?.('drain', () => {
            entry.ready = true
          })
        } catch {
          drop(writer)
        }
      }
    },
    close: () => {
      for (const writer of [...writers.keys()]) drop(writer)
    },
  }
}

// The route side: one response, opened as a stream and closed with the request.
// The first frame is the fleet as it stands, so a reader does not wait a tick.
// The two shapes are narrowed here so a test can drive them without a socket.
export type StreamRequest = { on: (event: 'close', listener: () => void) => unknown }

export type StreamResponse = StreamWriter & {
  writeHead: (status: number, headers: Record<string, string>) => unknown
}

export const openStream = (
  req: StreamRequest,
  res: StreamResponse,
  registry: StreamRegistry,
  first: string
): void => {
  res.writeHead(200, streamHeaders)
  res.write(first)
  const remove = registry.add(res)
  req.on('close', remove)
}
