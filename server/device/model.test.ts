import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cachedModel, modelCache, modelFor, parseModelName } from './model.ts'

// Measured on a WiiM Mini (10/11/2026): `getStatusEx` answers `model: null` and
// `project: "Muzo_Mini"`, while the UPnP description names the receiver. These
// tests pin the reading, the vendor suffix and the caching, in that order.
const description = (model: string): string =>
  `<?xml version="1.0"?><root><device><friendlyName>Chambre</friendlyName>` +
  '<manufacturer>Linkplay Technology Inc.</manufacturer>' +
  `<modelName>${model}</modelName><UDN>uuid:FF970016-FB48-0603-A87E-3488FF970016</UDN></device></root>`

const stubbed = (body: string) => vi.fn(async () => new Response(body, { status: 200 }))

describe('parseModelName', () => {
  test('reads the model and drops the DLNA role suffix', () => {
    expect(parseModelName(description('WiiM Mini Receiver'))).toBe('WiiM Mini')
    expect(parseModelName(description('WiiM Pro Receiver'))).toBe('WiiM Pro')
  })

  test('keeps a name that carries no role suffix', () => {
    expect(parseModelName(description('WiiM Ultra'))).toBe('WiiM Ultra')
  })

  test('decodes the entities a description may carry', () => {
    expect(parseModelName(description('A &amp; B Receiver'))).toBe('A & B')
  })

  test('answers an empty name when the description carries none', () => {
    expect(parseModelName('<root><device></device></root>')).toBe('')
    expect(parseModelName('')).toBe('')
  })
})

describe('modelFor', () => {
  beforeEach(() => {
    modelCache.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('reads the description once and answers from the cache after that', async () => {
    const fetchSpy = stubbed(description('WiiM Mini Receiver'))
    vi.stubGlobal('fetch', fetchSpy)
    await expect(modelFor('192.0.2.10', 'Linkplay.4.6')).resolves.toBe('WiiM Mini')
    await expect(modelFor('192.0.2.10', 'Linkplay.4.6')).resolves.toBe('WiiM Mini')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('asks again after a firmware update, which is the only thing that can rename a build', async () => {
    const fetchSpy = stubbed(description('WiiM Mini Receiver'))
    vi.stubGlobal('fetch', fetchSpy)
    await modelFor('192.0.2.10', 'Linkplay.4.6')
    await modelFor('192.0.2.10', 'Linkplay.4.7')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  test('keeps the last name when a later read fails, and retries sooner than it renews', async () => {
    vi.stubGlobal('fetch', stubbed(description('WiiM Mini Receiver')))
    await modelFor('192.0.2.10', 'Linkplay.4.6')
    const failing = vi.fn(async () => {
      throw new Error('unreachable')
    })
    vi.stubGlobal('fetch', failing)
    // The cached value survives a failed read, so a busy speaker keeps its name.
    await expect(modelFor('192.0.2.10', 'Linkplay.4.6')).resolves.toBe('WiiM Mini')
    expect(failing).not.toHaveBeenCalled()
  })

  test('answers an empty name rather than failing when nothing answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('unreachable')
      })
    )
    await expect(modelFor('192.0.2.11', 'Linkplay.4.6')).resolves.toBe('')
    expect(cachedModel('192.0.2.11', 'Linkplay.4.6')).toBe('')
    // A failed read is remembered, so the next poll does not pay the timeout again.
    const second = vi.fn(async () => new Response('', { status: 500 }))
    vi.stubGlobal('fetch', second)
    await expect(modelFor('192.0.2.11', 'Linkplay.4.6')).resolves.toBe('')
    expect(second).not.toHaveBeenCalled()
  })
})
