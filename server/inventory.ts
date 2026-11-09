// The capability inventory: every command the hub relies on, asked once at
// report time, with the answer the device actually gave. It answers the first
// question of a support thread ("does this firmware even have what the hub
// needs") with evidence instead of with a firmware list, and it covers the
// commands the findings read too, so a silent rule can be told apart from a
// missing command.
//
// Same split as the rest of the device client: classification, assembly and
// rendering are pure, the transport and the cache stay in `readInventory`.
import { eqQuery, fetchCommand, resolveTarget, type Scheme, transportOf } from './device.ts'

// What the hub needs from a player, by area. One line per command: the report
// table is read by someone who does not know this API, and an area is what
// turns a wall of command names into a picture of the firmware.
// `send` is the exact command when the API needs an argument: the equalizer
// curve is only readable with the plugin uri and a source, so probing the bare
// name would report a false `unknown command`.
type Probe = { command: string; area: string; send?: string }

export const probeList: readonly Probe[] = [
  { command: 'getStatusEx', area: 'identity' },
  { command: 'getPlayerStatusEx', area: 'playback' },
  { command: 'getMetaInfo', area: 'playback' },
  { command: 'getPresetInfo', area: 'playback' },
  { command: 'getNewAudioOutputHardwareMode', area: 'routing' },
  { command: 'getSoundCardModeSupportList', area: 'routing' },
  { command: 'getAudioInputCapbility', area: 'inputs' },
  { command: 'getAudioInputEnable', area: 'inputs' },
  { command: 'getModeRename', area: 'inputs' },
  { command: 'GetAcousticCapability', area: 'equalizer' },
  { command: 'EQGetList', area: 'equalizer' },
  { command: 'EQGetLV2SourceBandEx', area: 'equalizer', send: eqQuery },
  { command: 'multiroom:getSlaveList', area: 'group' },
  { command: 'multiroom:getnamegrouplist', area: 'group' },
  { command: 'getNetworkHealth', area: 'diagnostics' },
  { command: 'getDebugInfo', area: 'diagnostics' },
  { command: 'getHwErrorInfo', area: 'diagnostics' },
  { command: 'getShutdown', area: 'timers' },
]

// Five states, because the device distinguishes them and the reader needs to:
// a command the firmware does not know, a command it knows and refuses, a
// command it answers with nothing, and a device that did not answer at all are
// four different repair paths.
export type AnswerStatus = 'supported' | 'unsupported' | 'failed' | 'empty' | 'unreachable'

export const statuses: readonly AnswerStatus[] = [
  'supported',
  'unsupported',
  'failed',
  'empty',
  'unreachable',
]

export type InventoryRow = {
  command: string
  area: string
  status: AnswerStatus
  // The answer itself, flattened and cut: the point is to show that something
  // came back, not to paste 2.8 KB into a table cell.
  preview: string
}

export type Inventory = {
  at: number
  rows: InventoryRow[]
  counts: Record<AnswerStatus, number>
}

// The path a request took: the configured host, the address it resolved to,
// and the scheme that answered. `null` transport means nothing answered yet.
export type Resolution = { host: string; ip: string; transport: Scheme | null }

const collapsed = (raw: string): string => raw.replace(/\s+/g, ' ').trim()

const answered = (raw: string | null): string => (raw === null ? '' : collapsed(raw))

// `null` is the transport giving up after both schemes; `unknown command` is
// the firmware saying it does not have the command; `Failed` is it saying it
// does and will not serve it right now. Everything else counts as an answer,
// including the bare `0` of `getShutdown`: a refusal we did not recognise is
// better shown as supported with its body than hidden as a failure.
export const classifyAnswer = (raw: string | null): AnswerStatus => {
  const body = answered(raw)
  if (raw === null) return 'unreachable'
  if (body === '') return 'empty'
  if (/^(unknown command|unsupported|command not found)/i.test(body)) return 'unsupported'
  if (/^failed/i.test(body) || /"status"\s*:\s*"failed"/i.test(body)) return 'failed'
  return 'supported'
}

const previewLimit = 160

const preview = (raw: string | null): string => {
  if (raw === null) return 'no answer'
  const body = answered(raw).replaceAll('`', "'")
  if (body === '') return 'empty body'
  return body.length <= previewLimit ? body : `${body.slice(0, previewLimit - 1)}…`
}

export const buildInventory = (
  probes: ReadonlyArray<Probe & { raw: string | null }>,
  at: number
): Inventory => {
  const counts: Record<AnswerStatus, number> = {
    supported: 0,
    unsupported: 0,
    failed: 0,
    empty: 0,
    unreachable: 0,
  }
  const rows = probes.map(probe => {
    const status = classifyAnswer(probe.raw)
    counts[status] += 1
    return {
      command: probe.command,
      area: probe.area,
      status,
      preview: preview(probe.raw),
    }
  })
  return { at, rows, counts }
}

// A cell breaks on a pipe, and a device name or a URL may carry one. The
// backtick wrapper is already safe: `preview` strips any it finds.
const cell = (value: string): string => value.replaceAll('|', '\\|')

const resolutionLine = (resolution: Resolution): string => {
  const scheme = resolution.transport ?? 'no successful call yet'
  const where =
    resolution.ip === resolution.host
      ? `\`${resolution.host}\``
      : `\`${resolution.host}\` → \`${resolution.ip}\``
  return `Probe path: ${where} over ${scheme}.`
}

const countsLine = (counts: Record<AnswerStatus, number>): string =>
  statuses.map(status => `${counts[status]} ${status}`).join(', ')

// The section the report appends before its raw answers. `null` inventory means
// the probe was skipped because the player was offline: saying so is better
// than an empty table a reader would take for a device without capabilities.
export const inventorySection = (
  inventory: Inventory | null,
  resolution: Resolution | null,
  now: number
): string[] => {
  const lines = ['## Capability inventory', '']
  if (resolution !== null) lines.push(resolutionLine(resolution), '')
  if (inventory === null) {
    lines.push('Not probed: the player was offline when the report was generated.', '')
    return lines
  }
  lines.push(`Probed ${new Date(inventory.at).toISOString()} (${ago(now, inventory.at)}).`, '')
  lines.push(`${countsLine(inventory.counts)}.`, '')
  lines.push('| Command | Area | Status | Answer |', '| --- | --- | --- | --- |')
  for (const row of inventory.rows) {
    lines.push(`| \`${row.command}\` | ${row.area} | ${row.status} | \`${cell(row.preview)}\` |`)
  }
  lines.push('')
  return lines
}

// The report is timestamped in UTC and read by a human: "2 min ago" is what
// tells them whether the probe is from this report or from the cache.
const ago = (now: number, at: number): string => {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} s ago`
  const minutes = Math.round(seconds / 60)
  return `${minutes} min ago`
}

export const resolutionFor = (host: string): Resolution => {
  const ip = resolveTarget(host)
  return { host, ip, transport: transportOf(ip) }
}

// Probing costs eighteen requests and the answer changes when the firmware
// changes, not between two clicks: cache it briefly so copying and downloading
// the report do not probe twice.
const inventoryTtlMs = 60_000
const inventories = new Map<string, Inventory>()

export const readInventory = async (host: string, now = Date.now()): Promise<Inventory> => {
  const ip = resolveTarget(host)
  const cached = inventories.get(ip)
  if (cached !== undefined && now - cached.at < inventoryTtlMs) return cached
  const probes = await Promise.all(
    probeList.map(async probe => ({
      ...probe,
      raw: await fetchCommand(ip, probe.send ?? probe.command),
    }))
  )
  const inventory = buildInventory(probes, now)
  inventories.set(ip, inventory)
  return inventory
}
