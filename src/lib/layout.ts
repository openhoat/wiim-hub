// The hub answers its devices in the order it happens to hold them, which moves
// when a speaker joins, leaves or is rediscovered: on screen, two cards swap for
// no reason the reader can see. The page therefore pins the first order it saw
// and keeps it, in one `localStorage` entry, and a gesture moves one card
// against its neighbour.
//
// The stored value is a preference, not state: a payload that does not look
// like one is dropped, and the page falls back to the order the hub sent.
export type Layout = {
  // Device addresses, in display order. An address the hub no longer reports is
  // dropped on the next pin, so a removed speaker does not hold a slot forever.
  order: string[]
  // Device addresses whose diagnostic card is folded: the header stays, the
  // body is one click away.
  collapsed: string[]
  // Device addresses whose group speakers list is folded. Expanded is the
  // default, so this only holds the lists the reader closed, keyed on the
  // address of the speaker that drives the group.
  groupsCollapsed: string[]
}

export type Keyed = { ip: string }

export const LAYOUT_KEY = 'wiim-hub:layout'

// The narrow surface of `Storage` the page needs: the tests hand it a map, the
// browser hands it `localStorage`, and neither has to know about the other.
export type LayoutStore = Pick<Storage, 'getItem' | 'setItem'>

export const emptyLayout: Layout = { order: [], collapsed: [], groupsCollapsed: [] }

// A hand edit, a payload from another release, a duplicated entry: keep the
// strings that are addresses, in order, once each.
const addresses = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const kept: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry === '' || seen.has(entry)) continue
    seen.add(entry)
    kept.push(entry)
  }
  return kept
}

export const parseLayout = (raw: string | null): Layout => {
  if (raw === null) return emptyLayout
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return emptyLayout
  }
  if (typeof body !== 'object' || body === null) return emptyLayout
  const { order, collapsed, groupsCollapsed } = body as {
    order?: unknown
    collapsed?: unknown
    groupsCollapsed?: unknown
  }
  return {
    order: addresses(order),
    collapsed: addresses(collapsed),
    groupsCollapsed: addresses(groupsCollapsed),
  }
}

export const serializeLayout = (layout: Layout): string =>
  JSON.stringify({
    order: layout.order,
    collapsed: layout.collapsed,
    groupsCollapsed: layout.groupsCollapsed,
  })

export const readLayout = (store: LayoutStore): Layout => {
  try {
    return parseLayout(store.getItem(LAYOUT_KEY))
  } catch {
    return emptyLayout
  }
}

export const writeLayout = (store: LayoutStore, layout: Layout): void => {
  try {
    store.setItem(LAYOUT_KEY, serializeLayout(layout))
  } catch {
    // private mode or a full quota: the order still applies for this session
  }
}

export const sameOrder = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((entry, index) => entry === right[index])

// What the page should store: the addresses it already places, restricted to
// the speakers the hub reports, then the ones it has never seen, appended in
// the order the hub named them. Pinning on every poll is what stops the cards
// from swapping under a refresh.
export const pinOrder = (order: readonly string[], devices: readonly Keyed[]): string[] => {
  const live = new Set(devices.map(device => device.ip))
  const pinned = order.filter(ip => live.has(ip))
  const placed = new Set(pinned)
  const missing = devices.map(device => device.ip).filter(ip => !placed.has(ip))
  return [...pinned, ...missing]
}

// The display order. Unknown addresses keep their arrival order after the known
// ones, which is exactly what the hub sent when the page has no preference yet.
export const sortDevices = <T extends Keyed>(
  devices: readonly T[],
  order: readonly string[]
): T[] => {
  const rank = new Map(order.map((ip, index) => [ip, index]))
  return [...devices].sort((left, right) => {
    const a = rank.get(left.ip) ?? Number.POSITIVE_INFINITY
    const b = rank.get(right.ip) ?? Number.POSITIVE_INFINITY
    if (a === b) return 0
    return a < b ? -1 : 1
  })
}

// One step against the neighbour, over the full order. `delta` is -1 for
// earlier, 1 for later; a move off either end changes nothing, so a disabled
// button and a stray keypress end the same way.
export const moveDevice = (
  devices: readonly Keyed[],
  order: readonly string[],
  ip: string,
  delta: -1 | 1
): string[] => {
  const pinned = pinOrder(order, devices)
  const from = pinned.indexOf(ip)
  if (from < 0) return pinned
  const to = from + delta
  if (to < 0 || to >= pinned.length) return pinned
  const next = [...pinned]
  next[from] = pinned[to]
  next[to] = pinned[from]
  return next
}

export const toggleCollapsed = (collapsed: readonly string[], ip: string): string[] =>
  collapsed.includes(ip) ? collapsed.filter(entry => entry !== ip) : [...collapsed, ip]

// A fold the page has no card for any more holds nothing: dropped on the next
// pin, the same way the order drops an address the hub stopped reporting.
export const pruneAddresses = (folded: readonly string[], devices: readonly Keyed[]): string[] => {
  const live = new Set(devices.map(device => device.ip))
  return folded.filter(ip => live.has(ip))
}
