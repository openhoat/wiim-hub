import { describe, expect, test } from 'vitest'
import {
  createStreamRegistry,
  heartbeatFrame,
  openStream,
  type StreamRequest,
  type StreamResponse,
  stateFrame,
  streamHeaders,
} from './stream.ts'

type Fake = StreamResponse & {
  chunks: string[]
  ended: number
  sent: number
  status: number
  headers: Record<string, string>
  drain: () => void
}

const fake = (options: { accept?: (chunk: string) => boolean; throws?: boolean } = {}): Fake => {
  const drains: (() => void)[] = []
  const writer: Fake = {
    chunks: [],
    ended: 0,
    sent: 0,
    status: 0,
    headers: {},
    writeHead: (status: number, headers: Record<string, string>) => {
      writer.status = status
      writer.headers = headers
    },
    write: chunk => {
      if (options.throws === true) throw new Error('broken pipe')
      writer.sent += 1
      if (options.accept !== undefined && !options.accept(chunk)) return false
      writer.chunks.push(chunk)
      return true
    },
    once: (_event: 'drain', listener: () => void) => {
      drains.push(listener)
    },
    // What Node emits once the socket buffer has room again.
    drain: () => {
      for (const listener of drains.splice(0)) listener()
    },
    end: () => {
      writer.ended += 1
    },
  }
  return writer
}

describe('stateFrame', () => {
  test('names the event and ends the frame on a blank line', () => {
    expect(stateFrame({ ts: 1, devices: [] })).toBe('event: state\ndata: {"ts":1,"devices":[]}\n\n')
  })

  test('keeps a JSON body on one line, so a newline in a title cannot split the frame', () => {
    expect(stateFrame({ title: 'a\nb' })).toBe('event: state\ndata: {"title":"a\\nb"}\n\n')
  })
})

describe('heartbeatFrame', () => {
  test('is a comment, which a reader ignores and a proxy still forwards', () => {
    expect(heartbeatFrame(42)).toBe(': heartbeat 42\n\n')
  })
})

describe('streamHeaders', () => {
  test('asks the intermediaries not to buffer, cache or rewrap the body', () => {
    expect(streamHeaders['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(streamHeaders['cache-control']).toContain('no-transform')
    expect(streamHeaders['x-accel-buffering']).toBe('no')
  })
})

describe('createStreamRegistry', () => {
  test('writes every frame to every open reader', () => {
    const registry = createStreamRegistry()
    const first = fake()
    const second = fake()
    registry.add(first)
    registry.add(second)
    registry.push('one')
    expect(registry.size()).toBe(2)
    expect(first.chunks).toEqual(['one'])
    expect(second.chunks).toEqual(['one'])
  })

  test('forgets a reader that left', () => {
    const registry = createStreamRegistry()
    const writer = fake()
    const remove = registry.add(writer)
    remove()
    registry.push('one')
    expect(registry.size()).toBe(0)
    expect(writer.chunks).toEqual([])
  })

  test('skips a frame for a busy reader instead of ending its stream', () => {
    const registry = createStreamRegistry()
    let busyOnce = true
    const busy = fake({
      accept: chunk => {
        if (chunk === 'one' && busyOnce) {
          busyOnce = false
          return false
        }
        return true
      },
    })
    registry.add(busy)
    registry.push('one')
    expect(registry.size()).toBe(1)
    expect(busy.ended).toBe(0)
    // The next tick would be buffered behind the first: it is dropped, because
    // the frame after it carries the same state.
    registry.push('two')
    expect(busy.chunks).toEqual([])
    busy.drain()
    registry.push('three')
    expect(busy.chunks).toEqual(['three'])
  })

  test('drops a reader whose socket is already gone', () => {
    const registry = createStreamRegistry()
    const broken = fake({ throws: true })
    registry.add(broken)
    registry.push('one')
    expect(registry.size()).toBe(0)
    expect(broken.ended).toBe(1)
  })

  test('closes every reader when the hub shuts down', () => {
    const registry = createStreamRegistry()
    const first = fake()
    const second = fake()
    registry.add(first)
    registry.add(second)
    registry.close()
    expect(registry.size()).toBe(0)
    expect([first.ended, second.ended]).toEqual([1, 1])
  })

  test('keeps the readers that still take the frame', () => {
    const registry = createStreamRegistry()
    const healthy = fake()
    const full = fake({ accept: chunk => chunk !== 'two' })
    registry.add(healthy)
    registry.add(full)
    registry.push('one')
    registry.push('two')
    expect(registry.size()).toBe(2)
    expect(healthy.chunks).toEqual(['one', 'two'])
    expect(full.chunks).toEqual(['one'])
    full.drain()
    registry.push('three')
    expect(full.chunks).toEqual(['one', 'three'])
  })
})

describe('openStream', () => {
  const request = (): StreamRequest & { close: () => void } => {
    const listeners: (() => void)[] = []
    return {
      on: (_event: 'close', listener: () => void) => {
        listeners.push(listener)
      },
      close: () => {
        for (const listener of listeners) listener()
      },
    }
  }

  test('opens the response as a stream, with the fleet it already has', () => {
    const registry = createStreamRegistry()
    const res = fake()
    openStream(request(), res, registry, stateFrame({ ts: 1 }))

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(res.chunks).toEqual(['event: state\ndata: {"ts":1}\n\n'])
    expect(registry.size()).toBe(1)
  })

  test('stops counting the reader when the request closes', () => {
    const registry = createStreamRegistry()
    const req = request()
    const res = fake()
    openStream(req, res, registry, '')
    registry.push('one')
    expect(res.chunks).toEqual(['', 'one'])

    req.close()
    registry.push('two')
    expect(registry.size()).toBe(0)
    expect(res.chunks).toEqual(['', 'one'])
  })
})
