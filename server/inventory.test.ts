// The inventory is the part of the report a support reader trusts or does not:
// each row claims "this firmware answered this command", so the classification
// is pinned against the answers a real player gave, negative ones included.
import { describe, expect, it } from 'vitest'
import {
  eqBands,
  inputCapability,
  metaInfo,
  modeRename,
  presetInfo,
  shutdown,
  statusEx,
} from './fixtures/wiim-pro.ts'
import {
  buildInventory,
  classifyAnswer,
  type Inventory,
  inventorySection,
  probeList,
  type Resolution,
  readInventory,
  resolutionFor,
} from './inventory.ts'

const at = Date.UTC(2026, 10, 9, 15, 0, 0)

describe('classifyAnswer', () => {
  it('separates the four ways a command can come back empty', () => {
    expect(classifyAnswer(null)).toBe('unreachable')
    expect(classifyAnswer('')).toBe('empty')
    expect(classifyAnswer('   \n ')).toBe('empty')
    expect(classifyAnswer('unknown command')).toBe('unsupported')
    expect(classifyAnswer('Unknown Command')).toBe('unsupported')
    expect(classifyAnswer('Failed')).toBe('failed')
  })

  it('reads a JSON refusal as a refusal, not as an answer', () => {
    expect(classifyAnswer('{"status":"Failed"}')).toBe('failed')
    expect(classifyAnswer('{ "status" : "failed" }')).toBe('failed')
  })

  it('counts anything else as an answer, bare numbers included', () => {
    expect(classifyAnswer(statusEx)).toBe('supported')
    expect(classifyAnswer(metaInfo)).toBe('supported')
    expect(classifyAnswer(presetInfo)).toBe('supported')
    expect(classifyAnswer(eqBands)).toBe('supported')
    expect(classifyAnswer(shutdown)).toBe('supported')
    expect(classifyAnswer('OK')).toBe('supported')
  })

  it('does not turn the vendor typo into a missing command', () => {
    // `getAudioInputCapbility` is the spelling the firmware expects; it answers
    // a JSON body, so the row must read as supported.
    expect(classifyAnswer(inputCapability)).toBe('supported')
    expect(classifyAnswer(modeRename)).toBe('failed')
  })
})

describe('buildInventory', () => {
  it('counts one status per probe and keeps the probe order', () => {
    const inventory = buildInventory(
      [
        { command: 'getStatusEx', area: 'identity', raw: statusEx },
        { command: 'getModeRename', area: 'inputs', raw: modeRename },
        { command: 'getInfo', area: 'legacy', raw: 'unknown command' },
        { command: 'getAllRoutines', area: 'routines', raw: '' },
        { command: 'getNetworkHealth', area: 'diagnostics', raw: null },
      ],
      at
    )
    expect(inventory.at).toBe(at)
    expect(inventory.rows.map(row => row.status)).toEqual([
      'supported',
      'failed',
      'unsupported',
      'empty',
      'unreachable',
    ])
    expect(inventory.counts).toEqual({
      supported: 1,
      unsupported: 1,
      failed: 1,
      empty: 1,
      unreachable: 1,
    })
  })

  it('flattens and cuts the answer so a table cell stays readable', () => {
    const inventory = buildInventory(
      [{ command: 'getStatusEx', area: 'identity', raw: statusEx }],
      at
    )
    const preview = inventory.rows[0].preview
    expect(preview.startsWith('{ "language": "fr-FR"')).toBe(true)
    expect(preview).not.toContain('\n')
    expect(preview).toHaveLength(160)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('names an absent answer instead of leaving the cell blank', () => {
    const inventory = buildInventory(
      [
        { command: 'getNetworkHealth', area: 'diagnostics', raw: null },
        { command: 'getAllRoutines', area: 'routines', raw: '  ' },
      ],
      at
    )
    expect(inventory.rows.map(row => row.preview)).toEqual(['no answer', 'empty body'])
  })

  it('lists every command the hub depends on, once', () => {
    const commands = probeList.map(probe => probe.command)
    expect(new Set(commands).size).toBe(commands.length)
    expect(commands).toContain('getStatusEx')
    expect(commands).toContain('getDebugInfo')
    // The equalizer curve is only readable with its plugin argument, and the
    // table shows the name a reader recognises.
    const eqProbe = probeList.find(probe => probe.command === 'EQGetLV2SourceBandEx')
    expect(eqProbe?.send).toContain('EQGetLV2SourceBandEx:{')
  })
})

describe('inventorySection', () => {
  const inventory = (): Inventory =>
    buildInventory(
      [
        { command: 'getStatusEx', area: 'identity', raw: '{ "a": "b|c" }' },
        { command: 'getInfo', area: 'legacy', raw: 'unknown command' },
        { command: 'getNetworkHealth', area: 'diagnostics', raw: null },
      ],
      at
    )
  const resolution: Resolution = {
    host: 'wiim.local',
    ip: '192.0.2.150',
    resolvedBy: 'mdns',
    transport: 'https',
  }

  it('states the probe path and the counts before the table', () => {
    const lines = inventorySection(inventory(), resolution, at + 120_000)
    const text = lines.join('\n')
    expect(lines[0]).toBe('## Capability inventory')
    expect(text).toContain('Probe path: `wiim.local` → `192.0.2.150`, resolved by mdns over https.')
    expect(text).toContain('Probed 2026-11-09T15:00:00.000Z (2 min ago).')
    expect(text).toContain('1 supported, 1 unsupported, 0 failed, 0 empty, 1 unreachable.')
    expect(text).toContain('| Command | Area | Status | Answer |')
    expect(text).toContain('| `getStatusEx` | identity | supported | `{ "a": "b\\|c" }` |')
    expect(text).toContain('| `getInfo` | legacy | unsupported | `unknown command` |')
    expect(text).toContain('| `getNetworkHealth` | diagnostics | unreachable | `no answer` |')
  })

  it('says the probe was skipped when the player was offline', () => {
    const offline: Resolution = {
      host: '192.0.2.150',
      ip: '192.0.2.150',
      resolvedBy: null,
      transport: null,
    }
    const text = inventorySection(null, offline, at).join('\n')
    // A host that is already an address is not repeated with an arrow.
    expect(text).toContain('Probe path: `192.0.2.150` over no successful call yet.')
    expect(text).toContain('Not probed: the player was offline')
    expect(text).not.toContain('| Command |')
  })

  it('ages the probe in the unit a reader needs', () => {
    expect(inventorySection(inventory(), resolution, at + 4000).join('\n')).toContain('(just now).')
    expect(inventorySection(inventory(), resolution, at + 25_000).join('\n')).toContain(
      '(25 s ago).'
    )
  })
})

describe('readInventory', () => {
  const probeRecorder = () => {
    const seen: string[] = []
    const probe = async (_ip: string, command: string): Promise<string | null> => {
      seen.push(command)
      return command === 'getModeRename' ? 'Failed' : 'OK'
    }
    return { seen, probe }
  }

  it('names the address and the scheme a host resolved to', () => {
    // A literal is not resolved again: the report shows it once, and no call
    // has succeeded yet on that address.
    expect(resolutionFor('192.0.2.40')).toEqual({
      host: '192.0.2.40',
      ip: '192.0.2.40',
      resolvedBy: null,
      transport: null,
    })
  })

  it('probes every command, with the argument the API requires', async () => {
    const { seen, probe } = probeRecorder()
    const inventory = await readInventory('192.0.2.41', at, probe)

    expect(inventory.at).toBe(at)
    expect(inventory.rows).toHaveLength(probeList.length)
    // One request per command, in the order the report lists them.
    expect(seen).toEqual(probeList.map(entry => entry.send ?? entry.command))
    expect(inventory.counts.failed).toBe(1)
    expect(inventory.counts.supported).toBe(probeList.length - 1)
  })

  it('serves the cached inventory instead of probing eighteen times twice', async () => {
    const { seen, probe } = probeRecorder()
    const first = await readInventory('192.0.2.42', at, probe)
    const second = await readInventory('192.0.2.42', at + 30_000, probe)

    expect(second).toBe(first)
    expect(seen).toHaveLength(probeList.length)
  })

  it('probes again once the answer is older than a minute', async () => {
    const { seen, probe } = probeRecorder()
    await readInventory('192.0.2.43', at, probe)
    const fresh = await readInventory('192.0.2.43', at + 60_001, probe)

    expect(fresh.at).toBe(at + 60_001)
    expect(seen).toHaveLength(probeList.length * 2)
  })
})
