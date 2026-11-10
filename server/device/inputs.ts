import { type OutputOption, readOutputs } from './outputs.ts'
import { isRecord, num, parseJson, text } from './payload.ts'
import { probeCommand, slowProbeTtlMs } from './probes.ts'

export type Capability = {
  at: number
  inputs: string[]
  inputLabels: Record<string, string>
  outputs: OutputOption[]
}

export const capabilityTtlMs = slowProbeTtlMs
export const capabilityCache = new Map<string, Capability>()

// Inputs come from two places: the physical list the model reports, then the
// inputs the user left enabled in the vendor app. A disabled input is kept
// when the device reports it as present, because the hardware did not vanish;
// only an input the user enabled but the capability list missed is added.
const pushMode = (list: string[], entry: unknown): void => {
  if (!isRecord(entry)) return
  const mode = text(entry.mode)
  if (mode !== '' && !list.includes(mode)) list.push(mode)
}

const pushEnabledMode = (list: string[], entry: unknown): void => {
  if (!isRecord(entry)) return
  const mode = text(entry.mode)
  if (mode !== '' && num(entry.enable) === 1 && !list.includes(mode)) list.push(mode)
}

const readInputs = (capabilityRaw: string | null, enableRaw: string | null): string[] => {
  const list: string[] = []
  const capability = parseJson(capabilityRaw)
  if (Array.isArray(capability?.audioInput)) {
    for (const entry of capability.audioInput) pushMode(list, entry)
  }
  const enable = parseJson(enableRaw)
  if (Array.isArray(enable?.audioInput)) {
    for (const entry of enable.audioInput) pushEnabledMode(list, entry)
  }
  return list
}

const readLabels = (raw: string | null): Record<string, string> => {
  const parsed = parseJson(raw)
  if (parsed === null) return {}
  const labels: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value !== '') labels[key] = value
  }
  return labels
}

type CapabilityView = Omit<Capability, 'at'>

export const emptyCapability = (): Capability => ({
  at: 0,
  inputs: [],
  inputLabels: {},
  outputs: [],
})

// A pure seam: the four capability answers in, the merged view out, `null` when
// this model answered nothing the hub understands. The cache stamp and the
// fallback to what was already known stay in `capabilityFor`, which is what
// makes the awkward answers testable without a speaker.
export const parseCapability = (answers: {
  inputs: string | null
  enable: string | null
  rename: string | null
  outputs: string | null
}): CapabilityView | null => {
  const inputs = readInputs(answers.inputs, answers.enable)
  const outputs = readOutputs(answers.outputs)
  if (inputs.length === 0 && outputs.length === 0) return null
  return { inputs, inputLabels: readLabels(answers.rename), outputs }
}

// Probing a capability costs four requests and the answer almost never
// changes: cache it per address, and never let a failed probe erase what was
// already known. The probes themselves go through `probeCommand`, so a build
// that answers `unknown command` stops being asked.
export const capabilityFor = async (ip: string, firmware: string): Promise<Capability> => {
  const cached = capabilityCache.get(ip)
  if (cached !== undefined && Date.now() - cached.at < capabilityTtlMs) return cached
  const [primaryRaw, enableRaw, renameRaw, outputRaw] = await Promise.all([
    probeCommand(ip, firmware, 'getAudioInputCapbility'),
    probeCommand(ip, firmware, 'getAudioInputEnable'),
    probeCommand(ip, firmware, 'getModeRename'),
    probeCommand(ip, firmware, 'getSoundCardModeSupportList'),
  ])
  // `getAudioInputCapbility` is the vendor's own spelling, typo included. A
  // model that only answers the corrected name would otherwise lose its whole
  // input list, so the miss costs one retry once per cache window.
  const capabilityRaw =
    parseJson(primaryRaw) === null
      ? await probeCommand(ip, firmware, 'getAudioInputCapability')
      : primaryRaw
  const parsed = parseCapability({
    inputs: capabilityRaw,
    enable: enableRaw,
    rename: renameRaw,
    outputs: outputRaw,
  })
  if (parsed === null) return cached ?? emptyCapability()
  const value: Capability = { at: Date.now(), ...parsed }
  capabilityCache.set(ip, value)
  return value
}
