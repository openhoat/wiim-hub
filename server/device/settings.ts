import { num, parseJson, text } from './payload.ts'
import { fetchCommand } from './transport.ts'

// The device settings a user may change. They are read on demand rather than
// on every poll: four extra requests every three seconds to display values
// nobody is looking at is a cost the speaker does not need.
export type DeviceSettings = {
  name: string
  ledOn: boolean | null
  buttonsOn: boolean | null
  balance: number | null
  maxVolume: number | null
  fade: boolean | null
}

// LED and button answers are a bare `0`/`1`; the fade answer is a JSON object.
// One reader for both, and `null` when the model does not know the setting.
const flagOf = (raw: string | null): boolean | null => {
  if (raw === null) return null
  const answer = raw.trim()
  const direct = Number.parseInt(answer, 10)
  if (Number.isFinite(direct)) return direct === 1
  const parsed = parseJson(answer)
  if (parsed === null) return null
  for (const value of Object.values(parsed)) {
    const flag = typeof value === 'number' ? value : Number.parseInt(text(value), 10)
    if (Number.isFinite(flag)) return flag === 1
  }
  return null
}

const floatOf = (raw: string | null): number | null => {
  if (raw === null) return null
  const parsed = Number.parseFloat(raw.trim())
  return Number.isFinite(parsed) ? parsed : null
}

export const readSettings = async (ip: string): Promise<DeviceSettings | null> => {
  const [statusRaw, ledRaw, buttonRaw, balanceRaw, fadeRaw] = await Promise.all([
    fetchCommand(ip, 'getStatusEx'),
    fetchCommand(ip, 'LED_SWITCH_GET'),
    fetchCommand(ip, 'Button_Enable_GET'),
    fetchCommand(ip, 'getChannelBalance'),
    fetchCommand(ip, 'GetFadeFeature'),
  ])
  const status = parseJson(statusRaw)
  if (status === null) return null
  return {
    name: text(status.DeviceName),
    ledOn: flagOf(ledRaw),
    buttonsOn: flagOf(buttonRaw),
    balance: floatOf(balanceRaw),
    maxVolume: num(status.max_volume),
    fade: flagOf(fadeRaw),
  }
}
