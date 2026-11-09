import { describe, expect, it } from 'vitest'
import { streamServices } from './fixtures/wiim-pro.ts'
import { parseServicesCapability, readServices } from './services.ts'

describe('parseServicesCapability', () => {
  it('reads the table the reference player sent', () => {
    const services = parseServicesCapability(streamServices)
    expect(services).not.toBeNull()
    expect(services).toHaveLength(29)
    const tidal = services?.find(service => service.id === 'Tidal')
    expect(tidal).toEqual({
      id: 'Tidal',
      version: '2.3',
      levels: ['LOW', 'HIGH', 'LOSSLESS', 'HI_RES'],
      replayGain: true,
      configurable: false,
      active: false,
    })
  })

  it('keeps the levels in the order the device published them', () => {
    // The order is the only ranking the hub is allowed to use.
    const services = parseServicesCapability(streamServices) ?? []
    expect(services.find(service => service.id === 'Prime')?.levels).toEqual(['SD', 'HD', 'UHD'])
    expect(services.find(service => service.id === 'Deezer2')?.levels).toEqual([
      'LOW',
      'MEDIUM',
      'HIGH',
      'LOSSLESS',
    ])
  })

  it('keeps a family that publishes no level, and the endpoints the app drives', () => {
    const services = parseServicesCapability(streamServices) ?? []
    expect(services.find(service => service.id === 'newTuneIn')).toMatchObject({ levels: [] })
    expect(services.find(service => service.id === 'SpotifyConnect')).toMatchObject({
      levels: [],
      configurable: true,
      active: true,
    })
  })

  it('refuses what is not a service list', () => {
    expect(parseServicesCapability(null)).toBeNull()
    expect(parseServicesCapability('')).toBeNull()
    expect(parseServicesCapability('unknown command')).toBeNull()
    expect(parseServicesCapability('{"version":"1.6"}')).toBeNull()
    expect(parseServicesCapability('{"streamServices":[]}')).toBeNull()
    expect(parseServicesCapability('{"streamServices":"nope"}')).toBeNull()
  })

  it('survives a malformed entry instead of losing the table', () => {
    const services = parseServicesCapability(
      '{"streamServices":[null,{"id":""},{"version":"1"},{"id":"Solo","quality":["a","a",2,""]}]}'
    )
    // The bitrate came as a number, the repeated level is one level, and the
    // three entries without a usable id are gone.
    expect(services).toEqual([
      {
        id: 'Solo',
        version: '',
        levels: ['a', '2'],
        replayGain: false,
        configurable: false,
        active: false,
      },
    ])
  })

  it('reads the flags the device sends as numbers or booleans', () => {
    const services = parseServicesCapability(
      '{"streamServices":[{"id":"A","replayGain":true,"active":1,"configurable":"1"}]}'
    )
    expect(services?.[0]).toMatchObject({ replayGain: true, active: true, configurable: true })
  })
})

describe('readServices', () => {
  it('probes once per window and keeps the answer', async () => {
    const calls: string[] = []
    const probe = async (_ip: string, command: string): Promise<string | null> => {
      calls.push(command)
      return streamServices
    }
    const first = await readServices('192.0.2.10', 1_000, probe)
    const second = await readServices('192.0.2.10', 2_000, probe)
    expect(calls).toEqual(['streamServicesCapability'])
    expect(second).toEqual(first)
  })

  it('keeps what the model published when a later probe fails', async () => {
    const answers = [streamServices, 'unknown command']
    const probe = async (): Promise<string | null> => answers.shift() ?? null
    await readServices('192.0.2.11', 1_000, probe)
    // The window elapsed, and this time the firmware answered nothing: an empty
    // table would be a lie about the model.
    const after = await readServices('192.0.2.11', 1_000_000, probe)
    expect(after).toHaveLength(29)
  })

  it('answers an empty table for a device that never published one', async () => {
    const probe = async (): Promise<string | null> => 'unknown command'
    expect(await readServices('192.0.2.12', 1_000, probe)).toEqual([])
  })
})
