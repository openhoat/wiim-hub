import { isRecord, parseArray, text } from './payload.ts'

// An output the hub is able to select. `hardware` is the integer the device
// expects in `setAudioOutputHardwareMode`, mapped from the mode name: the
// `index` field of `getSoundCardModeSupportList` is not documented as the same
// value, so an unknown mode name stays unselectable instead of being guessed.
export type OutputOption = { hardware: number; name: string }

const hardwareByOutputMode: Record<string, number> = {
  AUDIO_OUTPUT_SPDIF_MODE: 1,
  AUDIO_OUTPUT_AUX_MODE: 2,
  AUDIO_OUTPUT_COAX_MODE: 3,
  AUDIO_OUTPUT_BT_MODE: 4,
  AUDIO_OUTPUT_USB_MODE: 8,
}

export const readOutputs = (raw: string | null): OutputOption[] => {
  const parsed = parseArray(raw)
  if (parsed === null) return []
  const outputs: OutputOption[] = []
  for (const entry of parsed) {
    if (!isRecord(entry) || !isRecord(entry.soundCard)) continue
    const hardware = hardwareByOutputMode[text(entry.mode)]
    const name = text(entry.soundCard.devName)
    if (hardware === undefined || name === '') continue
    if (outputs.some(output => output.hardware === hardware)) continue
    outputs.push({ hardware, name })
  }
  return outputs
}
