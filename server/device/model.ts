// The model a card shows. `getStatusEx` is the obvious source, and on the units
// measured (10/11/2026) it carries no `model` field at all: it answers
// `model: null` plus a `project` string, which is the internal build name
// ("Muzo_Mini" on a WiiM Mini, "WiiM_Pro_with_gc4a" on a WiiM Pro). Reading it
// as the model put "Muzo Mini" on a card for a speaker that calls itself
// "WiiM Mini Receiver" in its own UPnP description.
//
// So the public name is read where the device publishes it, on the description
// every control point already fetches, and the project string only answers for a
// build that says nothing. The answer never changes outside a firmware update,
// which is why it is cached for hours rather than read on every poll.
const descriptionPort = 49152
const readTtlMs = 6 * 60 * 60 * 1000
// A speaker that did not answer a moment ago may answer now: a failed read is
// retried far sooner than a successful one is renewed, so one busy boot does not
// leave the model empty for the rest of the day.
const retryTtlMs = 10 * 60 * 1000
const readTimeoutMs = 2000

type ModelEntry = { value: string; at: number; read: boolean }

// Keyed by the firmware as well: a build answers its own description, and an
// update is the one event that can change the name.
export const modelCache = new Map<string, ModelEntry>()

const cacheKey = (ip: string, firmware: string): string => `${ip}|${firmware}`

export const cachedModel = (ip: string, firmware: string): string =>
  modelCache.get(cacheKey(ip, firmware))?.value ?? ''

const decodeEntities = (value: string): string =>
  value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')

// The description names the DLNA role with the model ("WiiM Mini Receiver",
// "WiiM Pro Receiver"), while the firmware and the vendor app call the speaker
// "WiiM Mini": the suffix is dropped rather than shown to the reader.
export const parseModelName = (xml: string): string => {
  const match = /<modelName>([^<]*)<\/modelName>/i.exec(xml)
  if (match === null) return ''
  return decodeEntities(match[1])
    .replace(/\s+receiver\s*$/i, '')
    .trim()
}

export const modelFor = async (ip: string, firmware: string): Promise<string> => {
  const key = cacheKey(ip, firmware)
  const cached = modelCache.get(key)
  const now = Date.now()
  if (cached !== undefined && now - cached.at < (cached.read ? readTtlMs : retryTtlMs)) {
    return cached.value
  }
  let value = ''
  try {
    const response = await fetch(`http://${ip}:${descriptionPort}/description.xml`, {
      signal: AbortSignal.timeout(readTimeoutMs),
    })
    if (response.ok) value = parseModelName(await response.text())
  } catch {
    // A speaker that does not answer here is still named by the project string:
    // the caller falls back instead of losing the card.
  }
  if (value === '') {
    modelCache.set(key, { value: cached?.value ?? '', at: now, read: false })
    return cached?.value ?? ''
  }
  modelCache.set(key, { value, at: now, read: true })
  return value
}
