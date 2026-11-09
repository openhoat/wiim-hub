// The page keeps the last state the hub sent, so an unreachable hub leaves the
// cards on screen instead of an empty page. What it must not do is present that
// state as current: the snapshot carries the moment it was received, and the
// banner shows that age, so a stale volume is never read as the live one.
//
// The stored copy is the answer the hub wrote, nothing else: no merging, no
// defaults. A payload that does not look like one is dropped, and the page falls
// back to its empty state rather than rendering half a device.
import type { HubState } from './types'

export type Snapshot = { at: number; state: HubState }

export const SNAPSHOT_KEY = 'wiim-hub:last-state'

// The narrow surface of `Storage` the page needs: the tests hand it a map, the
// browser hands it `localStorage`, and neither has to know about the other.
export type SnapshotStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const parseSnapshot = (raw: string | null): Snapshot | null => {
  if (raw === null) return null
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const { at, state } = body as { at?: unknown; state?: unknown }
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  if (typeof state !== 'object' || state === null) return null
  const { ts, pollMs, devices } = state as { ts?: unknown; pollMs?: unknown; devices?: unknown }
  if (typeof ts !== 'number' || typeof pollMs !== 'number' || !Array.isArray(devices)) return null
  // The payload was written by this page from the hub's own answer: validating
  // every field of every device would duplicate the types for no gain, and the
  // cards tolerate a field they do not know.
  return { at, state: state as HubState }
}

export const serializeSnapshot = (state: HubState, at: number): string =>
  JSON.stringify({ at, state })

// A refusal here is never fatal: private mode and a full quota both mean the page
// works without a snapshot, which is what it did before.
export const readSnapshot = (store: SnapshotStore): Snapshot | null => {
  try {
    return parseSnapshot(store.getItem(SNAPSHOT_KEY))
  } catch {
    return null
  }
}

export const writeSnapshot = (store: SnapshotStore, state: HubState, at: number): void => {
  try {
    store.setItem(SNAPSHOT_KEY, serializeSnapshot(state, at))
  } catch {
    // no room: the last successful state lives in memory anyway
  }
}

export const clearSnapshot = (store: SnapshotStore): void => {
  try {
    store.removeItem(SNAPSHOT_KEY)
  } catch {
    // nothing to clear if the storage refused us
  }
}
