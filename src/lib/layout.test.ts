import { describe, expect, it } from 'vitest'
import {
  emptyLayout,
  LAYOUT_KEY,
  type Layout,
  type LayoutStore,
  moveDevice,
  parseLayout,
  pinOrder,
  readLayout,
  sameOrder,
  serializeLayout,
  sortDevices,
  toggleCollapsed,
  writeLayout,
} from './layout.ts'

const livingRoom = { ip: '192.0.2.21' }
const bedroom = { ip: '192.0.2.22' }
const kitchen = { ip: '192.0.2.23' }

const memory = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial))
  const store: LayoutStore = {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    },
  }
  return { store, items }
}

describe('parseLayout', () => {
  it('reads back what the page wrote', () => {
    const layout: Layout = { order: [bedroom.ip, livingRoom.ip], collapsed: [bedroom.ip] }
    expect(parseLayout(serializeLayout(layout))).toEqual(layout)
  })

  it('falls back to the hub order on anything else', () => {
    expect(parseLayout(null)).toEqual(emptyLayout)
    expect(parseLayout('')).toEqual(emptyLayout)
    expect(parseLayout('{"order":')).toEqual(emptyLayout)
    expect(parseLayout('[]')).toEqual(emptyLayout)
    expect(parseLayout('"x"')).toEqual(emptyLayout)
  })

  it('keeps only addresses, in order, once each', () => {
    expect(parseLayout('{"order":["a","a",3,"","b",null],"collapsed":"c"}')).toEqual({
      order: ['a', 'b'],
      collapsed: [],
    })
  })
})

describe('the stored layout', () => {
  it('round trips through the store', () => {
    const { store, items } = memory()
    writeLayout(store, { order: [bedroom.ip], collapsed: [livingRoom.ip] })
    expect(readLayout(store)).toEqual({ order: [bedroom.ip], collapsed: [livingRoom.ip] })
    expect(items.has(LAYOUT_KEY)).toBe(true)
  })

  it('survives a store that refuses to read or write', () => {
    const refusing: LayoutStore = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(readLayout(refusing)).toEqual(emptyLayout)
    expect(() => writeLayout(refusing, emptyLayout)).not.toThrow()
  })
})

describe('pinOrder', () => {
  it('keeps the order already decided, whatever the hub answers', () => {
    expect(pinOrder([bedroom.ip, livingRoom.ip], [livingRoom, bedroom])).toEqual([
      bedroom.ip,
      livingRoom.ip,
    ])
  })

  it('appends a speaker it has never seen, then keeps it', () => {
    const first = pinOrder([], [livingRoom, bedroom])
    expect(first).toEqual([livingRoom.ip, bedroom.ip])
    expect(pinOrder(first, [kitchen, bedroom, livingRoom])).toEqual([
      livingRoom.ip,
      bedroom.ip,
      kitchen.ip,
    ])
  })

  it('drops an address the hub no longer reports', () => {
    expect(pinOrder([kitchen.ip, bedroom.ip], [bedroom])).toEqual([bedroom.ip])
  })
})

describe('sortDevices', () => {
  it('follows the stored order', () => {
    expect(sortDevices([livingRoom, bedroom], [bedroom.ip, livingRoom.ip])).toEqual([
      bedroom,
      livingRoom,
    ])
  })

  it('puts an unknown address after the known ones, in the order it arrived', () => {
    expect(sortDevices([kitchen, bedroom, livingRoom], [livingRoom.ip, bedroom.ip])).toEqual([
      livingRoom,
      bedroom,
      kitchen,
    ])
  })

  it('answers the hub order when nothing is stored', () => {
    expect(sortDevices([bedroom, livingRoom], [])).toEqual([bedroom, livingRoom])
  })
})

describe('moveDevice', () => {
  it('swaps a speaker with its neighbour', () => {
    expect(
      moveDevice([livingRoom, bedroom], [livingRoom.ip, bedroom.ip], livingRoom.ip, 1)
    ).toEqual([bedroom.ip, livingRoom.ip])
  })

  it('leaves the ends alone', () => {
    const order = [livingRoom.ip, bedroom.ip]
    expect(moveDevice([livingRoom, bedroom], order, livingRoom.ip, -1)).toEqual(order)
    expect(moveDevice([livingRoom, bedroom], order, bedroom.ip, 1)).toEqual(order)
  })

  it('places the full fleet before moving, so a new speaker does not block a step', () => {
    expect(moveDevice([livingRoom, bedroom], [livingRoom.ip], bedroom.ip, -1)).toEqual([
      bedroom.ip,
      livingRoom.ip,
    ])
  })

  it('answers the order unchanged for an address it does not hold', () => {
    expect(moveDevice([livingRoom], [], kitchen.ip, -1)).toEqual([livingRoom.ip])
  })
})

describe('toggleCollapsed', () => {
  it('folds and unfolds one card', () => {
    const folded = toggleCollapsed([], livingRoom.ip)
    expect(folded).toEqual([livingRoom.ip])
    expect(toggleCollapsed(folded, livingRoom.ip)).toEqual([])
  })

  it('leaves the other cards untouched', () => {
    expect(toggleCollapsed([bedroom.ip], livingRoom.ip)).toEqual([bedroom.ip, livingRoom.ip])
  })
})

describe('sameOrder', () => {
  it('compares content, not identity', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameOrder(['a'], ['a', 'b'])).toBe(false)
    expect(sameOrder(['b', 'a'], ['a', 'b'])).toBe(false)
  })
})
