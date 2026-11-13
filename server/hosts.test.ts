import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  hostEntries,
  normalizeHost,
  parseHostsFile,
  readHostsFile,
  serializeHostsFile,
  sourceOf,
  writeHostsFile,
} from './hosts.ts'

describe('normalizeHost', () => {
  test('keeps an address or a name, trimmed', () => {
    expect(normalizeHost('192.0.2.150')).toBe('192.0.2.150')
    expect(normalizeHost('  living-room.local ')).toBe('living-room.local')
  })

  test('refuses what would become another endpoint', () => {
    // A scheme, a path or a query would address something else than the player,
    // and the poll would fail with a message about the wrong thing.
    expect(normalizeHost('http://192.0.2.150')).toBeNull()
    expect(normalizeHost('192.0.2.150/api')).toBeNull()
    expect(normalizeHost('192.0.2.150?x=1')).toBeNull()
    expect(normalizeHost('user@192.0.2.150')).toBeNull()
  })

  test('refuses an empty or non string entry', () => {
    expect(normalizeHost('')).toBeNull()
    expect(normalizeHost('   ')).toBeNull()
    expect(normalizeHost(150)).toBeNull()
    expect(normalizeHost(null)).toBeNull()
  })

  test('refuses a value long enough to be a payload', () => {
    expect(normalizeHost('a'.repeat(256))).toBeNull()
  })
})

describe('parseHostsFile', () => {
  test('reads the list the hub writes', () => {
    expect(parseHostsFile('{"hosts":["192.0.2.150","lab.local"]}')).toEqual([
      '192.0.2.150',
      'lab.local',
    ])
  })

  test('drops one broken entry instead of the whole list', () => {
    expect(parseHostsFile('{"hosts":["192.0.2.150","http://x/y","",null,42]}')).toEqual([
      '192.0.2.150',
    ])
  })

  test('keeps the first spelling of a duplicate', () => {
    expect(parseHostsFile('{"hosts":["lab.local"," lab.local ","lab.local"]}')).toEqual([
      'lab.local',
    ])
  })

  test('answers an empty list for anything it cannot read', () => {
    // A truncated file and a wrong shape are the two ways a hand edit goes
    // wrong, and neither may take the hub down at start.
    expect(parseHostsFile('{"hosts":')).toEqual([])
    expect(parseHostsFile('[]')).toEqual([])
    expect(parseHostsFile('{"hosts":"192.0.2.150"}')).toEqual([])
    expect(parseHostsFile('')).toEqual([])
  })
})

describe('serializeHostsFile', () => {
  test('writes a list a human can edit, with no duplicate', () => {
    expect(serializeHostsFile(['192.0.2.150', '192.0.2.150', 'lab.local'])).toBe(
      '{\n  "hosts": [\n    "192.0.2.150",\n    "lab.local"\n  ]\n}\n'
    )
  })

  test('survives the trip back through the parser', () => {
    const hosts = ['192.0.2.150', 'lab.local']
    expect(parseHostsFile(serializeHostsFile(hosts))).toEqual(hosts)
  })
})

describe('sourceOf', () => {
  const lists = { env: new Set(['env.local']), saved: new Set(['saved.local']) }

  test('gives the environment the first word, then the saved list', () => {
    expect(sourceOf('env.local', lists)).toBe('env')
    expect(sourceOf('saved.local', lists)).toBe('saved')
  })

  test('call anything else discovered', () => {
    expect(sourceOf('192.0.2.150', lists)).toBe('discovered')
  })
})

describe('hostEntries', () => {
  test('tags every host and sorts them, so the list does not follow poll order', () => {
    const entries = hostEntries(['saved.local', '192.0.2.150', 'env.local'], {
      env: new Set(['env.local']),
      saved: new Set(['saved.local']),
    })
    expect(entries).toEqual([
      { host: '192.0.2.150', source: 'discovered' },
      { host: 'env.local', source: 'env' },
      { host: 'saved.local', source: 'saved' },
    ])
  })
})

describe('the hosts file', () => {
  test('answers nothing when the file does not exist yet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wiim-hosts-'))
    try {
      await expect(readHostsFile(join(dir, 'hosts.json'))).resolves.toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('creates the directory and writes what it reads back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wiim-hosts-'))
    try {
      const path = join(dir, 'nested', 'hosts.json')
      await writeHostsFile(path, ['192.0.2.150'])
      await expect(readHostsFile(path)).resolves.toEqual(['192.0.2.150'])
      await expect(readFile(path, 'utf8')).resolves.toContain('"192.0.2.150"')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('replaces the list instead of appending to it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wiim-hosts-'))
    try {
      const path = join(dir, 'hosts.json')
      await writeFile(path, serializeHostsFile(['192.0.2.150', 'lab.local']), 'utf8')
      await writeHostsFile(path, ['192.0.2.151'])
      await expect(readHostsFile(path)).resolves.toEqual(['192.0.2.151'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
