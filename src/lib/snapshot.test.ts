import { describe, expect, test } from 'vitest'
import {
  clearSnapshot,
  parseSnapshot,
  readSnapshot,
  SNAPSHOT_KEY,
  type SnapshotStore,
  serializeSnapshot,
  writeSnapshot,
} from './snapshot.ts'
import type { HubState } from './types.ts'

const state: HubState = { ts: 1_700_000_000_000, pollMs: 3000, devices: [] }

// The smallest thing that behaves like `localStorage`: the module only needs the
// three calls, and a map makes a refusal trivial to simulate.
const memory = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial))
  const store: SnapshotStore = {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    },
    removeItem: key => {
      items.delete(key)
    },
  }
  return { store, items }
}

describe('parseSnapshot', () => {
  test('reads back what the page wrote', () => {
    expect(parseSnapshot(serializeSnapshot(state, 1_700_000_000_500))).toEqual({
      at: 1_700_000_000_500,
      state,
    })
  })

  test('refuses what it cannot parse or does not recognise', () => {
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot('')).toBeNull()
    expect(parseSnapshot('{"at":')).toBeNull()
    expect(parseSnapshot('[]')).toBeNull()
    expect(parseSnapshot('{"at":1}')).toBeNull()
  })

  test('refuses a payload that is not a hub answer', () => {
    // A hand edit or a leftover from another app: the page must fall back to its
    // empty state rather than render half a device.
    expect(parseSnapshot('{"at":1,"state":{"devices":[]}}')).toBeNull()
    expect(parseSnapshot('{"at":1,"state":{"ts":1,"pollMs":3000,"devices":null}}')).toBeNull()
    expect(parseSnapshot('{"at":"now","state":{"ts":1,"pollMs":3000,"devices":[]}}')).toBeNull()
  })
})

describe('the stored snapshot', () => {
  test('round trips through the store', () => {
    const { store } = memory()
    writeSnapshot(store, state, 42)
    expect(readSnapshot(store)).toEqual({ at: 42, state })
  })

  test('answers nothing when the store holds something else', () => {
    const { store } = memory({ 'another-key': 'x' })
    expect(readSnapshot(store)).toBeNull()
  })

  test('survives a store that refuses to read or write', () => {
    const refusing: SnapshotStore = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(readSnapshot(refusing)).toBeNull()
    expect(() => writeSnapshot(refusing, state, 42)).not.toThrow()
    expect(() => clearSnapshot(refusing)).not.toThrow()
  })

  test('clears only its own key', () => {
    const { store, items } = memory({ kept: 'y' })
    writeSnapshot(store, state, 42)
    clearSnapshot(store)
    expect(items.has(SNAPSHOT_KEY)).toBe(false)
    expect(items.get('kept')).toBe('y')
  })
})
