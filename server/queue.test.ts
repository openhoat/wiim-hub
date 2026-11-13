import { describe, expect, test } from 'vitest'
import { createWriteQueue } from './queue.ts'

type Call = { key: string; command: string; answer: (body: string | null) => void }

// A send whose every answer is released by the test: the queue's ordering only
// shows up while a command is in flight.
const controlled = () => {
  const calls: Call[] = []
  const send = (key: string, command: string): Promise<string | null> =>
    new Promise(resolve => {
      calls.push({ key, command, answer: resolve })
    })
  return { calls, queue: createWriteQueue(send) }
}

describe('createWriteQueue', () => {
  test('sends one command at a time, in the order they were queued', async () => {
    const { calls, queue } = controlled()
    const first = queue.enqueue('lab', 'setPlayerCmd:pause', null)
    const second = queue.enqueue('lab', 'setPlayerCmd:next', null)

    expect(calls.map(call => call.command)).toEqual(['setPlayerCmd:pause'])
    calls[0].answer('OK')
    await expect(first).resolves.toEqual({
      ok: true,
      unsupported: false,
      command: 'setPlayerCmd:pause',
      body: 'OK',
    })

    expect(calls.map(call => call.command)).toEqual(['setPlayerCmd:pause', 'setPlayerCmd:next'])
    calls[1].answer('unknown command')
    await expect(second).resolves.toEqual({
      ok: false,
      unsupported: true,
      command: 'setPlayerCmd:next',
      body: 'unknown command',
    })
  })

  test('replaces a pending job of the same family and answers every caller once', async () => {
    const { calls, queue } = controlled()
    const first = queue.enqueue('lab', 'setPlayerCmd:vol:10', 'volume')
    const second = queue.enqueue('lab', 'setPlayerCmd:vol:20', 'volume')
    const third = queue.enqueue('lab', 'setPlayerCmd:vol:30', 'volume')

    expect(calls).toHaveLength(1)
    calls[0].answer('OK')
    await first

    expect(calls).toHaveLength(2)
    expect(calls[1].command).toBe('setPlayerCmd:vol:30')
    calls[1].answer('OK')

    const expected = { ok: true, unsupported: false, command: 'setPlayerCmd:vol:30', body: 'OK' }
    await expect(Promise.all([second, third])).resolves.toEqual([expected, expected])
  })

  test('never coalesces jobs of different families', async () => {
    const { calls, queue } = controlled()
    const volume = queue.enqueue('lab', 'setPlayerCmd:vol:10', 'volume')
    const seek = queue.enqueue('lab', 'setPlayerCmd:seek:10', 'seek')
    const balance = queue.enqueue('lab', 'setChannelBalance:0.5', 'balance')

    calls[0].answer('OK')
    await volume
    expect(calls.map(call => call.command)).toEqual(['setPlayerCmd:vol:10', 'setPlayerCmd:seek:10'])
    calls[1].answer('OK')
    await seek
    expect(calls.map(call => call.command)).toEqual([
      'setPlayerCmd:vol:10',
      'setPlayerCmd:seek:10',
      'setChannelBalance:0.5',
    ])
    calls[2].answer('OK')
    await balance
  })

  test('never coalesces a command that carries no family', async () => {
    const { calls, queue } = controlled()
    const first = queue.enqueue('lab', 'setPlayerCmd:pause', null)
    const second = queue.enqueue('lab', 'setPlayerCmd:pause', null)

    calls[0].answer('OK')
    await first
    expect(calls).toHaveLength(2)
    expect(calls[1].command).toBe('setPlayerCmd:pause')
    calls[1].answer('OK')
    await second
  })

  test('runs one writer per key, so two speakers write in parallel', () => {
    const { calls, queue } = controlled()
    void queue.enqueue('lab', 'setPlayerCmd:pause', null)
    void queue.enqueue('kitchen', 'setPlayerCmd:pause', null)

    expect(calls.map(call => call.key)).toEqual(['lab', 'kitchen'])
  })

  test('reports an unreachable device as a failed write with an empty body', async () => {
    const { calls, queue } = controlled()
    const result = queue.enqueue('lab', 'setPlayerCmd:pause', null)

    calls[0].answer(null)
    await expect(result).resolves.toEqual({
      ok: false,
      unsupported: false,
      command: 'setPlayerCmd:pause',
      body: '',
    })
  })

  test('restarts the writer once the queue drained', async () => {
    const { calls, queue } = controlled()
    const first = queue.enqueue('lab', 'setPlayerCmd:pause', null)
    calls[0].answer('OK')
    await first

    const second = queue.enqueue('lab', 'setPlayerCmd:next', null)
    expect(calls).toHaveLength(2)
    calls[1].answer('OK')
    await expect(second).resolves.toMatchObject({ ok: true, command: 'setPlayerCmd:next' })
  })
})
