import { lookup } from 'node:dns/promises'
import { readFile } from 'node:fs/promises'
import { isIpLiteral, resolveMdns } from '../mdns.ts'

// A resolver answers one question: which address does this host have right now
// on this network. The hub asks a chain of them, in order, and keeps the first
// answer.
//
// A chain rather than one mechanism, because no single one covers a home
// network: mDNS is the right answer when the speaker advertises itself, but a
// multicast query does not cross a docker bridge without host networking; a
// container is often blind to the system resolver for the same reason; and a
// network whose lease table the hub may read already knows the address, since
// the router handed it out. Each source is optional and the chain degrades to
// what it can see.
export type Resolver = {
  // Printed in the diagnostic report: "resolved by dhcp leases" is the first
  // thing a support thread needs when mDNS is the suspect.
  name: string
  resolve: (host: string) => Promise<string | null>
}

// The address to use right now, the source that produced it, and the two
// gestures the rest of the hub makes: ask (`target`) and doubt (`forget`).
export type Resolution = {
  target: (host: string) => string
  forget: (host: string) => void
  source: (host: string) => string | null
}

type Attempt = { ip: string | null; at: number; via: string | null }
type Known = { ip: string; via: string | null }

export type ResolutionOptions = {
  now?: () => number
  // How long a name keeps its answer, and how long a name that answered
  // nothing waits before being asked again.
  successTtlMs?: number
  failureTtlMs?: number
  // Two polls three seconds apart must not both trigger a query.
  minGapMs?: number
}

// The chain, the throttle and the last known address, with the clock injected:
// the interesting behaviour here is timing, and a test cannot wait 30 seconds
// for it.
export const createResolution = (
  resolvers: readonly Resolver[],
  {
    now = Date.now,
    successTtlMs = 30_000,
    failureTtlMs = 60_000,
    minGapMs = 5000,
  }: ResolutionOptions = {}
): Resolution => {
  const attempts = new Map<string, Attempt>()
  const known = new Map<string, Known>()
  const pending = new Set<string>()

  const refresh = (host: string): void => {
    if (pending.has(host)) return
    pending.add(host)
    void (async () => {
      try {
        let found: Known | null = null
        for (const resolver of resolvers) {
          const ip = await resolver.resolve(host)
          if (ip !== null) {
            found = { ip, via: resolver.name }
            break
          }
        }
        attempts.set(host, { ip: found?.ip ?? null, at: now(), via: found?.via ?? null })
        if (found !== null) known.set(host, found)
      } finally {
        pending.delete(host)
      }
    })()
  }

  // Returns the address to use right now and schedules a refresh when the
  // knowledge is stale. The first call of a session returns the host itself:
  // the poll fails once, the answer lands a few seconds later, the card
  // follows.
  const target = (host: string): string => {
    if (isIpLiteral(host)) return host
    const cached = attempts.get(host)
    const ttl = cached === undefined || cached.ip === null ? failureTtlMs : successTtlMs
    const stale = cached === undefined || now() - cached.at >= ttl
    const tooSoon = cached !== undefined && now() - cached.at < minGapMs
    if (stale && !tooSoon) refresh(host)
    return known.get(host)?.ip ?? host
  }

  // A device that stopped answering may have a new address, so the attempt has
  // to go. It is not a licence to query on every poll though: the marker is a
  // failure, which the failure window already throttles, so the next poll
  // resolves at once and the ones after it wait. Once that attempt failed in
  // turn, further doubt changes nothing. The last known address and its source
  // stay as the fallback, so a name that stops answering keeps its card.
  const forget = (host: string): void => {
    const cached = attempts.get(host)
    if (cached?.ip === null) return
    attempts.set(host, { ip: null, at: now() - failureTtlMs, via: null })
  }

  const source = (host: string): string | null => known.get(host)?.via ?? null

  return { target, forget, source }
}

// `host=address` pairs, comma or newline separated. The operator's own mapping
// comes first in the chain: when someone writes it down, nothing should argue.
// An entry without a valid address is ignored rather than half applied.
export const parseStaticMap = (raw: string): Map<string, string> => {
  const table = new Map<string, string>()
  for (const entry of raw.split(/[\n,]/)) {
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    const host = entry.slice(0, separator).trim().toLowerCase()
    const address = entry.slice(separator + 1).trim()
    if (host === '' || isIpLiteral(address) === false) continue
    table.set(host, address)
  }
  return table
}

export const staticResolver = (raw: string): Resolver => {
  const table = parseStaticMap(raw)
  // `resolve` is the chain's contract, so it answers a promise even though a
  // map lookup is synchronous: a source that is fast should not be a special
  // case in the loop above.
  return {
    name: 'static map',
    resolve: host => Promise.resolve(table.get(host.toLowerCase()) ?? null),
  }
}

// The system resolver: on a machine with nss-mdns it answers `.local`
// instantly, and it costs nothing elsewhere.
export const systemResolver: Resolver = {
  name: 'system dns',
  resolve: async host => {
    try {
      const result = await lookup(host, { family: 4 })
      return result.address
    } catch {
      return null
    }
  },
}

// The built-in mDNS query covers hosts where getaddrinfo has no mDNS path,
// containers included when the network forwards multicast.
export const mdnsResolver: Resolver = {
  name: 'mdns',
  resolve: async host => resolveMdns(host),
}

// dnsmasq and its forks (Pi-hole, OpenWrt, most router firmwares) write one
// line per active lease: `<expiry> <mac> <address> <hostname> <client id>`.
// The hostname is the name the device asked for, which is the one a user types,
// while the vendor app may show something else entirely.
export const parseLeases = (raw: string, nowMs = Date.now()): Map<string, string> => {
  const table = new Map<string, string>()
  const nowSeconds = Math.floor(nowMs / 1000)
  for (const line of raw.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 4) continue
    const [expiry, , address, hostname] = fields
    // `0` is an infinite lease; an expired one names an address the router has
    // probably handed to another device since. A line whose expiry cannot be
    // read is dropped rather than trusted: a stale address is worse than a
    // failure, which lets the next source answer.
    const expiresAt = Number.parseInt(expiry, 10)
    if (Number.isFinite(expiresAt) === false) continue
    if (expiresAt !== 0 && expiresAt < nowSeconds) continue
    const name = hostname.trim().toLowerCase()
    if (name === '' || name === '*' || isIpLiteral(address) === false) continue
    table.set(name, address)
  }
  return table
}

export type LeaseOptions = {
  path: string
  now?: () => number
  readFile?: (path: string) => Promise<string>
  ttlMs?: number
}

// The lease table is read at most once a minute: it changes when a device
// renews, and the chain only asks after a failed or stale attempt anyway.
export const leaseResolver = ({
  path,
  now = Date.now,
  readFile: read = async file => readFile(file, 'utf8'),
  ttlMs = 60_000,
}: LeaseOptions): Resolver => {
  let table: Map<string, string> | null = null
  let readAt = 0
  const current = async (): Promise<Map<string, string>> => {
    const at = now()
    if (table !== null && at - readAt < ttlMs) return table
    try {
      table = parseLeases(await read(path), at)
    } catch {
      // An unreadable file is a source that has nothing to say, not an error:
      // the chain keeps going with the sources it does have.
      table = new Map()
    }
    readAt = at
    return table
  }
  return {
    name: 'dhcp leases',
    resolve: async host => {
      const leases = await current()
      const name = host.toLowerCase()
      // A lease carries the name the device asked for (`kitchen`), while the
      // operator writes `kitchen.local`: compare the first label as a fallback.
      return leases.get(name) ?? leases.get(name.split('.')[0]) ?? null
    },
  }
}

// What the hub uses. The order is the order of trust: what an operator wrote
// down, then what the router handed out, then what the network answers.
export const defaultResolvers = (env: NodeJS.ProcessEnv = process.env): Resolver[] => {
  const leasesFile = (env.DEVICE_LEASES_FILE ?? '').trim()
  return [
    staticResolver(env.DEVICE_STATIC_HOSTS ?? ''),
    ...(leasesFile === '' ? [] : [leaseResolver({ path: leasesFile })]),
    systemResolver,
    mdnsResolver,
  ]
}

const defaultResolution = createResolution(defaultResolvers())

export const resolveTarget = (host: string): string => defaultResolution.target(host)
export const forgetTarget = (host: string): void => defaultResolution.forget(host)
export const resolutionSource = (host: string): string | null => defaultResolution.source(host)
