import { createServer, type Server } from 'node:net'
import { describe, expect, test } from 'vitest'
import { alivePorts } from './reach.ts'

const listen = async (): Promise<Server> => {
  const server = createServer(socket => socket.end())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return server
}

const portOf = (server: Server): number => {
  const address = server.address()
  return typeof address === 'object' && address !== null ? address.port : 0
}

const close = async (server: Server): Promise<void> => {
  await new Promise<void>(resolve => server.close(() => resolve()))
}

describe('alivePorts', () => {
  test('reports a port that accepts a connection', async () => {
    const server = await listen()
    try {
      expect(await alivePorts('127.0.0.1', [portOf(server)])).toEqual([portOf(server)])
    } finally {
      await close(server)
    }
  })

  test('reports nothing when the port refuses, and keeps the order it was asked in', async () => {
    const first = await listen()
    const second = await listen()
    const closed = await listen()
    const closedPort = portOf(closed)
    await close(closed)
    try {
      expect(await alivePorts('127.0.0.1', [closedPort])).toEqual([])
      expect(await alivePorts('127.0.0.1', [portOf(second), portOf(first)])).toEqual([
        portOf(second),
        portOf(first),
      ])
    } finally {
      await close(first)
      await close(second)
    }
  })
})
