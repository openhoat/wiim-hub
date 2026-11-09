import { describe, expect, it } from 'vitest'
import { isExternalInput, parseGroup } from './device.ts'

type Registry = Parameters<typeof parseGroup>[2]

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

describe('isExternalInput', () => {
  it('treats the analogue and optical inputs as sources without a track', () => {
    expect(isExternalInput('optical')).toBe(true)
    expect(isExternalInput('line-in')).toBe(true)
  })

  it('leaves the network playlist and the unmeasured inputs alone', () => {
    expect(isExternalInput('wifi')).toBe(false)
    expect(isExternalInput('bluetooth')).toBe(false)
    expect(isExternalInput('')).toBe(false)
  })
})
