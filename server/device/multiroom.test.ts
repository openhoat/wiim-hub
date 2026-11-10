import { describe, expect, it } from 'vitest'
import { savedGroups } from '../fixtures/wiim-pro.ts'
import { parseGroup, parseRegistry, type Registry } from './multiroom.ts'

// The registry the group bookkeeping reads: a saved group is what the vendor
// app remembers, a running group is what the device reports now.
const registry = (overrides: Partial<Registry> = {}): Registry => ({
  at: 0,
  groups: [],
  current: '',
  ...overrides,
})

describe('parseGroup', () => {
  it('reports no group when the device reports nothing', () => {
    expect(parseGroup(null, '0', registry())).toEqual({
      role: 'none',
      name: '',
      members: [],
      saved: false,
    })
  })

  it('reports a master and its members from the reported slave list', () => {
    const raw = {
      Slave_list: [
        { name: 'Bedroom', ip: '192.0.2.11', uuid: 'uuid-1' },
        { name: 'Kitchen', ip: '192.0.2.12', uuid: 'uuid-2' },
      ],
    }
    expect(parseGroup(raw, '0', registry())).toEqual({
      role: 'master',
      name: '',
      members: [
        { name: 'Bedroom', ip: '192.0.2.11', uuid: 'uuid-1' },
        { name: 'Kitchen', ip: '192.0.2.12', uuid: 'uuid-2' },
      ],
      saved: false,
    })
  })

  it('reads the member list under its three spellings', () => {
    for (const key of ['Slave_list', 'slavelist', 'slave_list']) {
      const parsed = parseGroup({ [key]: [{ name: 'Bedroom', uuid: 'uuid-1' }] }, '0', registry())
      expect(parsed.role).toBe('master')
      expect(parsed.members).toEqual([{ name: 'Bedroom', ip: '', uuid: 'uuid-1' }])
    }
  })

  it('falls back to the uuid when a member has no name', () => {
    const parsed = parseGroup({ Slave_list: [{ uuid: 'uuid-1' }] }, '0', registry())
    expect(parsed.members).toEqual([{ name: 'uuid-1', ip: '', uuid: 'uuid-1' }])
  })

  it('reports a master from the slave count alone', () => {
    expect(parseGroup({ Slaves: '2' }, '0', registry())).toMatchObject({
      role: 'master',
      members: [],
    })
  })

  it('reports a member when its status carries a group id', () => {
    expect(parseGroup(null, 'group-1', registry())).toMatchObject({ role: 'member' })
  })

  it('does not take the zero group id for a membership', () => {
    expect(parseGroup(null, '0', registry())).toMatchObject({ role: 'none' })
  })

  it('exposes the saved group of the registry, with no member online', () => {
    const saved = {
      id: 'group-1',
      name: 'Apartment',
      members: [{ name: 'Bedroom', ip: '', uuid: 'uuid-1' }],
    }
    expect(parseGroup(null, '0', registry({ groups: [saved], current: 'group-1' }))).toEqual({
      role: 'none',
      name: 'Apartment',
      members: [{ name: 'Bedroom', ip: '', uuid: 'uuid-1' }],
      saved: true,
    })
  })

  it('keeps the reported members when the saved group is also running', () => {
    const saved = {
      id: 'group-1',
      name: 'Apartment',
      members: [{ name: 'Kitchen', ip: '', uuid: 'uuid-9' }],
    }
    const parsed = parseGroup(
      { Slave_list: [{ name: 'Bedroom', uuid: 'uuid-1' }] },
      '0',
      registry({ groups: [saved], current: 'group-1' })
    )
    expect(parsed).toEqual({
      role: 'master',
      name: 'Apartment',
      members: [{ name: 'Bedroom', ip: '', uuid: 'uuid-1' }],
      saved: true,
    })
  })

  it('ignores a saved group the device does not point at', () => {
    const saved = { id: 'group-1', name: 'Apartment', members: [] }
    expect(parseGroup(null, '0', registry({ groups: [saved], current: 'group-2' }))).toEqual({
      role: 'none',
      name: '',
      members: [],
      saved: false,
    })
  })

  it('ignores a malformed reported member instead of inventing one', () => {
    const parsed = parseGroup({ Slaves: '2', Slave_list: [null, 'Bedroom', 3] }, '0', registry())
    expect(parsed.role).toBe('master')
    expect(parsed.members).toEqual([])
  })
})

describe('parseRegistry', () => {
  it('reads the saved group and its offline member', () => {
    expect(parseRegistry(savedGroups)).toEqual({
      groups: [
        {
          id: '11111111-2222-3333-4444-555555555555',
          name: 'Apartment',
          members: [{ name: 'Bedroom', ip: '', uuid: 'A1B2C3D4E5F60718293A4B5C' }],
        },
      ],
      current: '11111111-2222-3333-4444-555555555555',
    })
  })

  it('separates an unreadable answer from an empty registry', () => {
    // `null` means "keep what you knew"; an empty registry is a real answer.
    expect(parseRegistry('unknown command')).toBeNull()
    expect(parseRegistry(null)).toBeNull()
    expect(parseRegistry('{ "grouplist": [] }')).toEqual({ groups: [], current: '' })
  })

  it('skips a group without an id instead of inventing one', () => {
    const raw = JSON.stringify({
      grouplist: [
        { group_name: 'No id', slavelist: [{ name: 'Bedroom' }] },
        'unknown command',
        { group_id: 'group-1', group_name: 'Studio', slavelist: 'none' },
      ],
    })
    expect(parseRegistry(raw)).toEqual({
      groups: [{ id: 'group-1', name: 'Studio', members: [] }],
      current: '',
    })
  })
})
