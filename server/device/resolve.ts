import { lookup } from 'node:dns/promises'
import { isIpLiteral, resolveMdns } from '../mdns.ts'

// A device entry is a host: an address stays as is, a name is resolved on the
// network. Resolution never blocks a poll: a WiiM responder was measured
// answering between 0.5 s and 6 s, so waiting on it would stretch a 3 s poll
// and mark a reachable device offline. `known` keeps the last address that
// ever resolved, `attempts` throttles the queries.
type Resolution = { ip: string | null; at: number }
const attempts = new Map<string, Resolution>()
const known = new Map<string, string>()
const pending = new Set<string>()
const resolutionTtlMs = 30_000
const failureTtlMs = 60_000
const minAttemptGapMs = 5000

// The system resolver first: on a machine with nss-mdns it answers `.local`
// instantly, and it costs nothing elsewhere. The built-in mDNS query covers
// hosts where getaddrinfo has no mDNS path, containers included.
const lookupIp = async (host: string): Promise<string | null> => {
  try {
    const result = await lookup(host, { family: 4 })
    return result.address
  } catch {
    return null
  }
}

const refresh = (host: string): void => {
  if (pending.has(host)) return
  pending.add(host)
  void (async () => {
    try {
      const ip = (await lookupIp(host)) ?? (await resolveMdns(host))
      attempts.set(host, { ip, at: Date.now() })
      if (ip !== null) known.set(host, ip)
    } finally {
      pending.delete(host)
    }
  })()
}

// Returns the address to use right now and schedules a refresh when the
// knowledge is stale. The first call of a session returns the host itself:
// the poll fails once, the answer lands a few seconds later, the card follows.
export const resolveTarget = (host: string): string => {
  if (isIpLiteral(host)) return host
  const cached = attempts.get(host)
  const ttl = cached === undefined || cached.ip === null ? failureTtlMs : resolutionTtlMs
  const stale = cached === undefined || Date.now() - cached.at >= ttl
  const tooSoon = cached !== undefined && Date.now() - cached.at < minAttemptGapMs
  if (stale && !tooSoon) refresh(host)
  return known.get(host) ?? host
}

// Mark the attempt stale rather than dropping it: the next poll resolves
// again (a new DHCP lease), and the last known address stays as the fallback.
export const forgetTarget = (host: string): void => {
  const cached = attempts.get(host)
  if (cached !== undefined) attempts.set(host, { ip: cached.ip, at: 0 })
}
