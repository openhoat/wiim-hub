import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  emptyLayout,
  type Keyed,
  type Layout,
  type LayoutStore,
  moveDevice,
  pinOrder,
  pruneAddresses,
  readLayout,
  sameOrder,
  sortDevices,
  toggleCollapsed,
  writeLayout,
} from './layout'

// Private mode and a browser that refuses storage both raise on the accessor
// itself, before any call: reading through a guarded getter keeps the page
// working without a preference, as it did before the layout existed.
const browserStore = (): LayoutStore | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const persist = (layout: Layout): void => {
  const store = browserStore()
  if (store !== null) writeLayout(store, layout)
}

export type LayoutControls<T extends Keyed> = {
  // The hub's cards, in the order the page shows them.
  devices: T[]
  collapsed: ReadonlySet<string>
  groupsCollapsed: ReadonlySet<string>
  move: (ip: string, delta: -1 | 1) => void
  toggle: (ip: string) => void
  toggleGroup: (ip: string) => void
}

// The order is pinned the first time a speaker is seen and kept from then on:
// the hub is free to answer in another order (a speaker rejoins, discovery
// names it first) without the cards swapping under a refresh. Only an explicit
// move changes it, and that move is stored. The page hands in whatever it draws
// a card for, which is a group since a group is one card.
export const useLayout = <T extends Keyed>(devices: T[]): LayoutControls<T> => {
  const [layout, setLayout] = useState<Layout>(() => {
    const store = browserStore()
    return store === null ? emptyLayout : readLayout(store)
  })

  // Read inside the callbacks, so a move never acts on the answer of an older
  // poll while the effect below stays the only place that pins.
  const latest = useRef(devices)
  useEffect(() => {
    latest.current = devices
    // Before the first answer there is nothing to place, and pinning against an
    // empty fleet would wipe the stored order instead of waiting for it.
    if (devices.length === 0) return
    setLayout(current => {
      const order = pinOrder(current.order, devices)
      const groupsCollapsed = pruneAddresses(current.groupsCollapsed, devices)
      if (sameOrder(order, current.order) && sameOrder(groupsCollapsed, current.groupsCollapsed)) {
        return current
      }
      const next = { order, collapsed: current.collapsed, groupsCollapsed }
      persist(next)
      return next
    })
  }, [devices])

  const move = useCallback((ip: string, delta: -1 | 1): void => {
    setLayout(current => {
      const order = moveDevice(latest.current, current.order, ip, delta)
      if (sameOrder(order, current.order)) return current
      const next = { order, collapsed: current.collapsed, groupsCollapsed: current.groupsCollapsed }
      persist(next)
      return next
    })
  }, [])

  const toggle = useCallback((ip: string): void => {
    setLayout(current => {
      const next = {
        order: current.order,
        collapsed: toggleCollapsed(current.collapsed, ip),
        groupsCollapsed: current.groupsCollapsed,
      }
      persist(next)
      return next
    })
  }, [])

  const toggleGroup = useCallback((ip: string): void => {
    setLayout(current => {
      const next = {
        order: current.order,
        collapsed: current.collapsed,
        groupsCollapsed: toggleCollapsed(current.groupsCollapsed, ip),
      }
      persist(next)
      return next
    })
  }, [])

  const ordered = useMemo(() => sortDevices(devices, layout.order), [devices, layout.order])
  const collapsed = useMemo(() => new Set(layout.collapsed), [layout.collapsed])
  const groupsCollapsed = useMemo(() => new Set(layout.groupsCollapsed), [layout.groupsCollapsed])

  return { devices: ordered, collapsed, groupsCollapsed, move, toggle, toggleGroup }
}
