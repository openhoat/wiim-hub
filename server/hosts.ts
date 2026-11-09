// The hosts the hub polls come from three places, and only one of them belongs
// to the page: `DEVICE_HOSTS` is the operator's seed, discovery finds what is on
// the network, and the list written from the interface is the only one that
// survives a restart. Keeping the three apart is what lets the page say where an
// entry came from, and refuse to remove what it does not own.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type HostSource = 'env' | 'saved' | 'discovered'

export type HostEntry = { host: string; source: HostSource }

// A host is an address or a name the resolver can take, nothing more: a scheme,
// a path or a space would silently turn a typo into another endpoint, so they
// are refused here instead of failing at the first poll.
export const normalizeHost = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const host = value.trim()
  if (host === '' || host.length > 255) return null
  if (/[\s/?#@]/.test(host)) return null
  return host
}

// The file is written by the hub, but it is a plain JSON file next to a volume:
// a hand edit is expected, and one broken entry must not lose the other nine.
export const parseHostsFile = (raw: string): string[] => {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return []
  }
  if (typeof body !== 'object' || body === null) return []
  const list = (body as { hosts?: unknown }).hosts
  if (!Array.isArray(list)) return []
  const hosts = new Set<string>()
  for (const item of list) {
    const host = normalizeHost(item)
    if (host !== null) hosts.add(host)
  }
  return [...hosts]
}

export const serializeHostsFile = (hosts: readonly string[]): string =>
  `${JSON.stringify({ hosts: [...new Set(hosts)] }, null, 2)}\n`

export const readHostsFile = async (path: string): Promise<string[]> => {
  try {
    return parseHostsFile(await readFile(path, 'utf8'))
  } catch {
    // No file yet is the normal first start, not an error: the environment and
    // discovery still give the hub something to poll.
    return []
  }
}

// Written through a temporary file and a rename, so a reader never sees half a
// list and a crash leaves the previous one in place.
export const writeHostsFile = async (path: string, hosts: readonly string[]): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, serializeHostsFile(hosts), 'utf8')
  await rename(temporary, path)
}

// The source shown per host, in the order that decides who owns an entry: the
// environment seed cannot be removed from the page, a saved host can, and a
// discovered one has not been kept yet.
export const sourceOf = (
  host: string,
  lists: { env: ReadonlySet<string>; saved: ReadonlySet<string> }
): HostSource => {
  if (lists.env.has(host)) return 'env'
  if (lists.saved.has(host)) return 'saved'
  return 'discovered'
}

export const hostEntries = (
  hosts: Iterable<string>,
  lists: { env: ReadonlySet<string>; saved: ReadonlySet<string> }
): HostEntry[] =>
  [...hosts]
    .map(host => ({ host, source: sourceOf(host, lists) }))
    .sort((left, right) => left.host.localeCompare(right.host))
