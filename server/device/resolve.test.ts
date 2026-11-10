import { describe, expect, it, vi } from 'vitest'
import {
  createResolution,
  leaseResolver,
  parseLeases,
  parseStaticMap,
  type Resolver,
  staticResolver,
} from './resolve.ts'

// The refresh runs in the background on purpose (a poll never waits on a name),
// so a test has to let the microtasks of the chain drain before reading it.
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const fake = (
  name: string,
  answers: Record<string, string | null>
): Resolver & { calls: string[] } => {
  const calls: string[] = []
  return {
    name,
    calls,
    resolve: async host => {
      calls.push(host)
      return answers[host] ?? null
    },
  }
}

describe('parseStaticMap', () => {
  it('reads the pairs on one line or on several', () => {
    const table = parseStaticMap('kitchen=192.0.2.10\nBedroom.local = 192.0.2.11,')
    expect(table.get('kitchen')).toBe('192.0.2.10')
    expect(table.get('bedroom.local')).toBe('192.0.2.11')
    expect(table.size).toBe(2)
  })

  it('drops an entry without a name or with an address that is not one', () => {
    const table = parseStaticMap('=192.0.2.10,kitchen=,bedroom=kitchen,studio=192.0.2.12')
    expect([...table.entries()]).toEqual([['studio', '192.0.2.12']])
  })

  it('ignores an empty setting instead of throwing', () => {
    expect(parseStaticMap('').size).toBe(0)
  })
})

describe('staticResolver', () => {
  it('answers the hosts the operator wrote down, in any case', async () => {
    const resolver = staticResolver('Kitchen=192.0.2.10')
    expect(await resolver.resolve('kitchen')).toBe('192.0.2.10')
    expect(await resolver.resolve('bedroom')).toBeNull()
  })
})

describe('parseLeases', () => {
  const now = Date.UTC(2026, 10, 10, 12, 0, 0)
  // dnsmasq writes the expiry in seconds, so the fixtures are derived from the
  // clock the parser reads: a hardcoded stamp would quietly expire one day.
  const at = Math.floor(now / 1000)

  it('reads a dnsmasq lease table, with the infinite lease and the lower case', () => {
    const raw = [
      `${at + 3600} aa:bb:cc:dd:ee:01 192.0.2.10 Kitchen 01:aa:bb`,
      '0 aa:bb:cc:dd:ee:02 192.0.2.11 bedroom *',
      `${at + 3600} aa:bb:cc:dd:ee:03 192.0.2.12 * 01:aa:cc`,
    ].join('\n')
    expect([...parseLeases(raw, now).entries()]).toEqual([
      ['kitchen', '192.0.2.10'],
      ['bedroom', '192.0.2.11'],
    ])
  })

  it('drops an expired lease and keeps the address of a renewing one', () => {
    const raw = [
      `${at - 100} aa:bb:cc:dd:ee:01 192.0.2.10 kitchen 01:aa:bb`,
      `${at + 100} aa:bb:cc:dd:ee:02 192.0.2.11 bedroom 01:aa:cc`,
    ].join('\n')
    expect([...parseLeases(raw, now).entries()]).toEqual([['bedroom', '192.0.2.11']])
  })

  it('skips a line the hub cannot read rather than half of it', () => {
    const raw = ['# comment', 'garbage', '0 aa:bb 192.0.2.10', '0 mac not-an-address kitchen'].join(
      '\n'
    )
    expect(parseLeases(raw, now).size).toBe(0)
  })

  it('drops a lease whose expiry it cannot read instead of trusting the address', () => {
    const raw = 'soon aa:bb:cc:dd:ee:01 192.0.2.10 kitchen 01:aa:bb'
    expect(parseLeases(raw, now).size).toBe(0)
  })
})

describe('leaseResolver', () => {
  const raw = '0 aa:bb:cc:dd:ee:01 192.0.2.10 kitchen 01:aa:bb'

  it('matches the first label of a .local name against the lease hostname', async () => {
    const resolver = leaseResolver({ path: '/leases', readFile: async () => raw })
    expect(await resolver.resolve('kitchen.local')).toBe('192.0.2.10')
    expect(await resolver.resolve('kitchen')).toBe('192.0.2.10')
    expect(await resolver.resolve('bedroom.local')).toBeNull()
  })

  it('reads the file once per window, not once per name', async () => {
    const readFile = vi.fn(async () => raw)
    let at = 1000
    const resolver = leaseResolver({ path: '/leases', readFile, now: () => at, ttlMs: 5000 })
    await resolver.resolve('kitchen')
    await resolver.resolve('bedroom')
    expect(readFile).toHaveBeenCalledTimes(1)
    at += 5000
    await resolver.resolve('kitchen')
    expect(readFile).toHaveBeenCalledTimes(2)
  })

  it('says nothing when the file is unreadable, so the chain keeps going', async () => {
    const resolver = leaseResolver({
      path: '/missing',
      readFile: async () => {
        throw new Error('ENOENT')
      },
    })
    expect(await resolver.resolve('kitchen')).toBeNull()
  })
})

describe('createResolution', () => {
  it('returns the host itself until a source answers', async () => {
    const first = fake('static map', {})
    const resolution = createResolution([first])
    expect(resolution.target('kitchen.local')).toBe('kitchen.local')
    await flush()
    expect(first.calls).toEqual(['kitchen.local'])
    // Nothing answered: the poll keeps using the name and the card shows an
    // offline speaker rather than a wrong address.
    expect(resolution.target('kitchen.local')).toBe('kitchen.local')
    expect(resolution.source('kitchen.local')).toBeNull()
  })

  it('asks the chain in order and keeps the source of the first answer', async () => {
    const empty = fake('static map', {})
    const leases = fake('dhcp leases', { 'kitchen.local': '192.0.2.10' })
    const mdns = fake('mdns', { 'kitchen.local': '192.0.2.99' })
    const resolution = createResolution([empty, leases, mdns])
    resolution.target('kitchen.local')
    await flush()
    expect(resolution.target('kitchen.local')).toBe('192.0.2.10')
    expect(resolution.source('kitchen.local')).toBe('dhcp leases')
    // The later sources are not asked once one of them answered.
    expect(mdns.calls).toEqual([])
  })

  it('leaves an address literal alone and never asks', async () => {
    const first = fake('static map', {})
    const resolution = createResolution([first])
    expect(resolution.target('192.0.2.10')).toBe('192.0.2.10')
    await flush()
    expect(first.calls).toEqual([])
  })

  it('keeps an answer for its window and asks again after it', async () => {
    let at = 0
    const first = fake('static map', { kitchen: '192.0.2.10' })
    const resolution = createResolution([first], { now: () => at })
    resolution.target('kitchen')
    await flush()
    at = 29_000
    resolution.target('kitchen')
    await flush()
    expect(first.calls).toHaveLength(1)
    at = 30_000
    resolution.target('kitchen')
    await flush()
    expect(first.calls).toHaveLength(2)
  })

  it('waits longer after a failure, and never two queries back to back', async () => {
    let at = 0
    const first = fake('static map', {})
    const resolution = createResolution([first], { now: () => at })
    resolution.target('kitchen')
    await flush()
    // Three seconds later a poll arrives: still inside the minimum gap.
    at = 3000
    resolution.target('kitchen')
    await flush()
    expect(first.calls).toHaveLength(1)
    // Past the gap but inside the failure window: still one attempt.
    at = 10_000
    resolution.target('kitchen')
    await flush()
    expect(first.calls).toHaveLength(1)
    at = 60_000
    resolution.target('kitchen')
    await flush()
    expect(first.calls).toHaveLength(2)
  })

  it('resolves again after forget, and keeps the last address meanwhile', async () => {
    const at = 10_000
    const answers: Record<string, string | null> = { kitchen: '192.0.2.10' }
    const first = fake('static map', answers)
    const resolution = createResolution([first], { now: () => at })
    resolution.target('kitchen')
    await flush()
    expect(resolution.target('kitchen')).toBe('192.0.2.10')
    answers.kitchen = '192.0.2.11'
    resolution.forget('kitchen')
    // The old address still answers until the new one lands.
    expect(resolution.target('kitchen')).toBe('192.0.2.10')
    await flush()
    expect(resolution.target('kitchen')).toBe('192.0.2.11')
    expect(first.calls).toHaveLength(2)
  })

  it('stops querying on every offline poll once an attempt has failed', async () => {
    const answers: Record<string, string | null> = { kitchen: '192.0.2.10' }
    const first = fake('static map', answers)
    let at = 10_000
    const resolution = createResolution([first], { now: () => at })
    resolution.target('kitchen')
    await flush()
    // The device stops answering: doubt drops the known answer and the next
    // call resolves again at once, keeping the last address as the fallback.
    answers.kitchen = null
    resolution.forget('kitchen')
    expect(resolution.target('kitchen')).toBe('192.0.2.10')
    await flush()
    expect(first.calls).toHaveLength(2)
    // Still offline three seconds later: the failure window covers the polls
    // that follow, so a dead speaker is not one query per poll.
    at = 13_000
    resolution.forget('kitchen')
    resolution.target('kitchen')
    await flush()
    expect(first.calls).toHaveLength(2)
  })

  it('keeps the previous source when a later attempt fails', async () => {
    const answers: Record<string, string | null> = { kitchen: '192.0.2.10' }
    const first = fake('dhcp leases', answers)
    let at = 0
    const resolution = createResolution([first], { now: () => at })
    resolution.target('kitchen')
    await flush()
    expect(resolution.source('kitchen')).toBe('dhcp leases')
    answers.kitchen = null
    at = 60_000
    resolution.target('kitchen')
    await flush()
    expect(resolution.target('kitchen')).toBe('192.0.2.10')
    expect(resolution.source('kitchen')).toBe('dhcp leases')
  })
})
