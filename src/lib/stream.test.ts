import { describe, expect, test, vi } from 'vitest'
import {
  createFrameParser,
  firstEventMs,
  readStateStream,
  type StreamFrame,
  stateFromFrame,
  streamPath,
} from './stream'
import type { HubState } from './types'

const fleet = (ts: number): HubState => ({ ts, pollMs: 3000, devices: [] })

const frame = (state: HubState): string => `event: state\ndata: ${JSON.stringify(state)}\n\n`

const responseOf = (chunks: string[]): Response => {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start: controller => {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

describe('createFrameParser', () => {
  test('reads a frame and drops the delimiter', () => {
    const parser = createFrameParser()
    expect(parser.push('event: state\ndata: {"a":1}\n\n')).toEqual([
      { event: 'state', data: '{"a":1}' },
    ])
  })

  test('keeps an incomplete frame until the blank line arrives', () => {
    const parser = createFrameParser()
    expect(parser.push('event: state\ndata: {"a"')).toEqual([])
    expect(parser.push(':1}\n')).toEqual([])
    expect(parser.push('\n')).toEqual([{ event: 'state', data: '{"a":1}' }])
  })

  test('reads several frames out of one chunk', () => {
    const parser = createFrameParser()
    expect(parser.push('event: state\ndata: 1\n\nevent: state\ndata: 2\n\n')).toEqual([
      { event: 'state', data: '1' },
      { event: 'state', data: '2' },
    ])
  })

  test('reads CRLF, a lone CR, and a pair split across two chunks', () => {
    const parser = createFrameParser()
    expect(parser.push('event: state\r\ndata: 1\r\n\r\n')).toEqual([{ event: 'state', data: '1' }])
    // A lone CR ends a line too; the last one of a chunk may open a CRLF, so it
    // is read with the next chunk instead of counting twice.
    expect(parser.push('event: state\rdata: 2\r\r')).toEqual([])
    expect(parser.push('\r')).toEqual([{ event: 'state', data: '2' }])
    const split = createFrameParser()
    expect(split.push('event: state\r')).toEqual([])
    expect(split.push('\ndata: 3\r\n\r\n')).toEqual([{ event: 'state', data: '3' }])
  })

  test('ignores a comment block, which is what the heartbeat is', () => {
    const parser = createFrameParser()
    expect(parser.push(': heartbeat 12\n\n')).toEqual([])
    expect(parser.push(': heartbeat 12\n\nevent: state\ndata: 1\n\n')).toEqual([
      { event: 'state', data: '1' },
    ])
  })

  test('joins several data lines and keeps a field it does not know', () => {
    const parser = createFrameParser()
    expect(parser.push('id: 7\nevent: state\ndata: a\ndata: b\n\n')).toEqual([
      { event: 'state', data: 'a\nb' },
    ])
  })

  test('names a frame that carries no event', () => {
    const parser = createFrameParser()
    expect(parser.push('data: hello\n\n')).toEqual([{ event: 'message', data: 'hello' }])
  })
})

describe('stateFromFrame', () => {
  const valid: StreamFrame = { event: 'state', data: JSON.stringify(fleet(1)) }

  test('reads the fleet out of a state frame', () => {
    expect(stateFromFrame(valid)).toEqual(fleet(1))
  })

  test('refuses another event, a broken body, or a body that is not a fleet', () => {
    expect(stateFromFrame({ ...valid, event: 'message' })).toBeNull()
    expect(stateFromFrame({ ...valid, data: '{' })).toBeNull()
    expect(stateFromFrame({ ...valid, data: '{"ts":1}' })).toBeNull()
    expect(stateFromFrame({ ...valid, data: '"a string"' })).toBeNull()
    expect(stateFromFrame({ ...valid, data: '{"ts":"x","pollMs":1,"devices":[]}' })).toBeNull()
  })
})

describe('readStateStream', () => {
  const read = async (options: {
    timeoutMs?: number
    signal?: AbortSignal
    onState?: (state: HubState) => void
  }): Promise<{ states: number[]; outcome: string }> => {
    const states: number[] = []
    const outcome = await readStateStream({
      signal: options.signal ?? new AbortController().signal,
      timeoutMs: options.timeoutMs,
      onState: state => {
        states.push(state.ts)
        options.onState?.(state)
      },
    })
    return { states, outcome }
  }

  test('reads the frames it is served and ends with the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => responseOf([frame(fleet(1)), frame(fleet(2))]))
    )
    await expect(read({})).resolves.toEqual({ states: [1, 2], outcome: 'closed' })
    vi.unstubAllGlobals()
  })

  test('reads a fleet split across chunks', async () => {
    const body = frame(fleet(1))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => responseOf([body.slice(0, 12), body.slice(12, 25), body.slice(25)]))
    )
    await expect(read({})).resolves.toEqual({ states: [1], outcome: 'closed' })
    vi.unstubAllGlobals()
  })

  test('asks for the stream of the hub, without caching it', async () => {
    const fake = vi.fn(async () => responseOf([]))
    vi.stubGlobal('fetch', fake)
    await read({})
    expect(fake).toHaveBeenCalledWith(streamPath, expect.objectContaining({ cache: 'no-store' }))
    vi.unstubAllGlobals()
  })

  test('gives up on a route that is not there', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 }))
    )
    await expect(read({})).resolves.toEqual({ states: [], outcome: 'unsupported' })
    vi.unstubAllGlobals()
  })

  test('gives up on a body that stays silent, and releases it', async () => {
    const seen: (AbortSignal | null | undefined)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: RequestInit) => {
        seen.push(init?.signal)
        return new Response(
          new ReadableStream<Uint8Array>({
            start: controller => {
              init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')))
            },
          }),
          { status: 200 }
        )
      })
    )
    await expect(read({ timeoutMs: 10 })).resolves.toEqual({
      states: [],
      outcome: 'unsupported',
    })
    expect(seen[0]?.aborted).toBe(true)
    vi.unstubAllGlobals()
  })

  test('renews a stream that broke after delivering a fleet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const encoder = new TextEncoder()
        return new Response(
          new ReadableStream<Uint8Array>({
            start: controller => {
              controller.enqueue(encoder.encode(frame(fleet(1))))
            },
            pull: controller => {
              controller.error(new Error('connection reset'))
            },
          }),
          { status: 200 }
        )
      })
    )
    await expect(read({})).resolves.toEqual({ states: [1], outcome: 'closed' })
    vi.unstubAllGlobals()
  })

  test('stops reading when the page goes away', async () => {
    const control = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const encoder = new TextEncoder()
        return new Response(
          new ReadableStream<Uint8Array>({
            start: stream => {
              stream.enqueue(encoder.encode(frame(fleet(1))))
              control.signal.addEventListener('abort', () => stream.error(new Error('aborted')))
            },
          }),
          { status: 200 }
        )
      })
    )
    const promise = read({ signal: control.signal, onState: () => control.abort() })
    await expect(promise).resolves.toEqual({ states: [1], outcome: 'closed' })
    vi.unstubAllGlobals()
  })
})

describe('stream constants', () => {
  test('names a route and a timeout the page can describe', () => {
    expect(streamPath).toBe('/api/events')
    expect(firstEventMs).toBe(5000)
  })
})
