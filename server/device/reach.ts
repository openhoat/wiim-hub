import { connect } from 'node:net'

// A speaker whose control API stopped answering is not necessarily gone: the
// firmware can lose its HTTP service while the device keeps running the group
// stream and its other ports. Measured on a WiiM Mini (21/11/2026): 443 refused
// every connection while 8819 and 49152 still accepted one. A bare TCP connect
// is therefore the only local evidence of "powered and on the network" the hub
// can gather without the vendor cloud.
//
// The control port is not probed: its refusal is what raises the question, and a
// build that answers it is online by definition.
export const reachPorts = [8819, 49152] as const

const connectTimeoutMs = 1500

const accepts = (ip: string, port: number): Promise<boolean> =>
  new Promise(resolve => {
    const socket = connect({ host: ip, port })
    const settle = (answer: boolean): void => {
      socket.destroy()
      resolve(answer)
    }
    socket.setTimeout(connectTimeoutMs, () => settle(false))
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
  })

// Every port is tried, not only the first that accepts: the list is what the
// finding shows, and a reader checking the claim sees the same addresses. A
// refusal is immediate on the LAN; a filtered address costs the timeout per
// port, on the slow cadence only.
export const alivePorts = async (
  ip: string,
  ports: readonly number[] = reachPorts
): Promise<number[]> => {
  const open: number[] = []
  for (const port of ports) {
    if (await accepts(ip, port)) open.push(port)
  }
  return open
}

// What a probe answered, kept on the device state: the page reads this, never
// the network, so a request never waits on a silent address.
export type Reach = {
  at: number
  ports: number[]
}
