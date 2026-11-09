import { createSocket } from 'node:dgram'

// Minimal mDNS A-record resolver. It exists so a device can be configured by
// name (`kitchen.local`) instead of by address: a DHCP lease change then stays
// invisible, which a fixed DEVICE_HOSTS entry cannot promise. Multicast does
// not always cross a container bridge, so the query sets the unicast-response
// bit and the socket accepts answers on both paths.

const mdnsAddress = '224.0.0.251'
const mdnsPort = 5353
// A WiiM responder is not fast: measured answers arrive between 0.5 s and
// 3.2 s, so a one-second window reports a reachable device as absent.
const defaultTimeoutMs = 3000

export const isIpLiteral = (value: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(value)

const encodeName = (name: string): Buffer => {
  const labels = name.replace(/\.$/, '').split('.').filter(Boolean)
  const parts: Buffer[] = []
  for (const label of labels) {
    const bytes = Buffer.from(label, 'utf8')
    parts.push(Buffer.from([bytes.length]), bytes)
  }
  parts.push(Buffer.from([0]))
  return Buffer.concat(parts)
}

const buildQuery = (name: string): Buffer => {
  const header = Buffer.alloc(12)
  header.writeUInt16BE(0, 0)
  header.writeUInt16BE(0, 2)
  header.writeUInt16BE(1, 4)
  // A record, class IN with the unicast-response bit set.
  const question = Buffer.concat([encodeName(name), Buffer.from([0x00, 0x01, 0x80, 0x01])])
  return Buffer.concat([header, question])
}

const isPointer = (length: number): boolean => (length & 0xc0) === 0xc0

const pointerTarget = (buffer: Buffer, cursor: number, length: number): number =>
  ((length & 0x3f) << 8) | buffer[cursor + 1]

// `next` is where the record continues, so it is frozen as soon as a pointer
// was followed: the jump lands elsewhere in the message, not in this record.
const advance = (jumped: boolean, next: number, candidate: number): number =>
  jumped ? next : candidate

// DNS names are length-prefixed and may be compressed with a pointer to an
// earlier occurrence, so a reader must be able to follow a pointer without
// losing track of where the current record continues.
const readName = (buffer: Buffer, offset: number): { name: string; next: number } => {
  const labels: string[] = []
  let next = offset
  let jumped = false
  let cursor = offset
  // A pointer chain that loops is malformed, and 64 labels is far more than a
  // name: the guard bounds the read instead of trusting the message.
  for (let guard = 0; cursor < buffer.length && guard < 64; guard += 1) {
    const length = buffer[cursor]
    if (isPointer(length)) {
      if (cursor + 1 >= buffer.length) break
      next = advance(jumped, next, cursor + 2)
      cursor = pointerTarget(buffer, cursor, length)
      jumped = true
      continue
    }
    if (length === 0) {
      next = advance(jumped, next, cursor + 1)
      break
    }
    labels.push(buffer.toString('utf8', cursor + 1, cursor + 1 + length))
    next = advance(jumped, next, cursor + 1 + length)
    cursor += 1 + length
  }
  return { name: labels.join('.').toLowerCase(), next }
}

const parseAnswer = (buffer: Buffer, target: string): string | null => {
  if (buffer.length < 12) return null
  const questions = buffer.readUInt16BE(4)
  const answers = buffer.readUInt16BE(6)
  let offset = 12
  for (let index = 0; index < questions; index += 1) {
    const { next } = readName(buffer, offset)
    offset = next + 4
  }
  for (let index = 0; index < answers; index += 1) {
    const { name, next } = readName(buffer, offset)
    if (next + 10 > buffer.length) return null
    const type = buffer.readUInt16BE(next)
    const length = buffer.readUInt16BE(next + 8)
    const dataOffset = next + 10
    if (type === 1 && length === 4 && name === target) {
      return `${buffer[dataOffset]}.${buffer[dataOffset + 1]}.${buffer[dataOffset + 2]}.${buffer[dataOffset + 3]}`
    }
    offset = dataOffset + length
  }
  return null
}

const queryOnce = (target: string, port: number, timeoutMs: number): Promise<string | null> =>
  new Promise(resolve => {
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    const timers: NodeJS.Timeout[] = []
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      for (const timer of timers) clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // already closed
      }
      resolve(value)
    }
    timers.push(setTimeout(() => finish(null), timeoutMs))
    socket.on('error', () => finish(null))
    socket.on('message', message => {
      const ip = parseAnswer(message, target)
      if (ip !== null) finish(ip)
    })
    socket.bind(port, () => {
      try {
        socket.addMembership(mdnsAddress)
      } catch {
        // membership is best effort, the unicast-response bit covers the rest
      }
      const query = buildQuery(target)
      const send = (): void => {
        socket.send(query, mdnsPort, mdnsAddress, error => {
          if (error) finish(null)
        })
      }
      // A responder may suppress a repeated answer for about a second, and
      // multicast is lossy: ask again instead of trusting one datagram.
      send()
      for (const delay of [600, 1200]) timers.push(setTimeout(send, delay))
    })
  })

// Ask on the mDNS port first (multicast answers land there); when another
// resolver already holds it, fall back to an ephemeral port, which only sees
// unicast answers.
export const resolveMdns = async (
  name: string,
  timeoutMs = defaultTimeoutMs
): Promise<string | null> => {
  const target = name.replace(/\.$/, '').toLowerCase()
  const shared = await queryOnce(target, mdnsPort, timeoutMs)
  if (shared !== null) return shared
  return queryOnce(target, 0, timeoutMs)
}
