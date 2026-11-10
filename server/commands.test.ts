import { describe, expect, it } from 'vitest'
import { commandFor, commandOutcome, eqBandNames, parseAction } from './commands.ts'
import type { DeviceState } from './device/index.ts'

// A device that supports one input, one output and one preset: enough to
// exercise every check `commandFor` makes against the retained state.
const device = (overrides: Partial<DeviceState> = {}): DeviceState => ({
  ip: '192.0.2.10',
  name: 'Living Room',
  model: 'WiiM Pro',
  firmware: 'Linkplay.4.8',
  release: '20261027',
  ssid: 'lab',
  bssid: 'aa:bb:cc:dd:ee:ff',
  wmrmVersion: '4.3',
  group: { role: 'none', name: '', members: [], saved: false },
  rssi: -55,
  volume: 30,
  status: 'play',
  title: 'Track',
  artist: 'Artist',
  album: 'Album',
  albumArt: '',
  curposMs: 0,
  totalMs: 0,
  source: 'wifi',
  mode: '10',
  input: 'wifi',
  maxVolume: 100,
  mute: false,
  sleepSeconds: 0,
  inputs: ['wifi', 'optical'],
  inputLabels: { wifi: 'Wi-Fi', optical: 'Optical' },
  outputs: [{ hardware: 1, name: 'Optical' }],
  outputHardware: 1,
  presets: [{ number: 1, name: 'Radio', artwork: '' }],
  eq: { enabled: true, name: 'Rock', source: 'wifi', bands: [], presets: ['Rock'], roomFit: false },
  quality: { sampleRate: 48000, bitDepth: 16, bitRate: 128 },
  updatedAt: 1,
  online: true,
  lastSeen: 1,
  errors: 0,
  upnp: { state: 'off', lastEventAt: null, events: 0, misses: 0 },
  link: { snr: null, noise: null, freqMhz: null, rateMbps: null },
  diagnostics: null,
  samples: [],
  events: [],
  ...overrides,
})

describe('parseAction', () => {
  it('rejects a body that is not an object', () => {
    expect(parseAction(null)).toEqual({ error: 'body must be an object' })
    expect(parseAction('play')).toEqual({ error: 'body must be an object' })
    expect(parseAction(42)).toEqual({ error: 'body must be an object' })
    // An array is an object: it fails on the missing action instead.
    expect(parseAction([])).toEqual({ error: 'missing action' })
  })

  it('rejects a missing or non-string action', () => {
    expect(parseAction({})).toEqual({ error: 'missing action' })
    expect(parseAction({ action: 3 })).toEqual({ error: 'missing action' })
  })

  it.each(['play', 'pause', 'toggle', 'stop', 'next', 'prev'])(
    'accepts the fixed action %s without any field',
    action => {
      expect(parseAction({ action })).toEqual({ action: { action } })
    }
  )

  it('accepts a seek position between zero and one day', () => {
    expect(parseAction({ action: 'seek', seconds: 0 })).toEqual({
      action: { action: 'seek', seconds: 0 },
    })
    expect(parseAction({ action: 'seek', seconds: 86_400 })).toEqual({
      action: { action: 'seek', seconds: 86_400 },
    })
  })

  it('rejects a seek position outside the range or not an integer', () => {
    expect(parseAction({ action: 'seek', seconds: -1 })).toEqual({ error: 'invalid seek position' })
    expect(parseAction({ action: 'seek', seconds: 86_401 })).toEqual({
      error: 'invalid seek position',
    })
    expect(parseAction({ action: 'seek', seconds: 1.5 })).toEqual({
      error: 'invalid seek position',
    })
    expect(parseAction({ action: 'seek', seconds: '10' })).toEqual({
      error: 'invalid seek position',
    })
    expect(parseAction({ action: 'seek' })).toEqual({ error: 'invalid seek position' })
  })

  it('accepts a volume between zero and one hundred', () => {
    expect(parseAction({ action: 'volume', level: 0 })).toEqual({
      action: { action: 'volume', level: 0 },
    })
    expect(parseAction({ action: 'volume', level: 100 })).toEqual({
      action: { action: 'volume', level: 100 },
    })
  })

  it('rejects a volume outside the range or not an integer', () => {
    expect(parseAction({ action: 'volume', level: -1 })).toEqual({ error: 'invalid volume level' })
    expect(parseAction({ action: 'volume', level: 101 })).toEqual({ error: 'invalid volume level' })
    expect(parseAction({ action: 'volume', level: 42.5 })).toEqual({
      error: 'invalid volume level',
    })
  })

  it('accepts a mute flag and rejects anything else', () => {
    expect(parseAction({ action: 'mute', muted: true })).toEqual({
      action: { action: 'mute', muted: true },
    })
    expect(parseAction({ action: 'mute', muted: 'yes' })).toEqual({ error: 'invalid mute flag' })
  })

  it('accepts a non-empty source and rejects an empty or non-string one', () => {
    expect(parseAction({ action: 'source', input: 'optical' })).toEqual({
      action: { action: 'source', input: 'optical' },
    })
    expect(parseAction({ action: 'source', input: '' })).toEqual({ error: 'invalid input' })
    expect(parseAction({ action: 'source', input: 3 })).toEqual({ error: 'invalid input' })
  })

  it('accepts a preset slot between one and forty', () => {
    expect(parseAction({ action: 'preset', slot: 1 })).toEqual({
      action: { action: 'preset', slot: 1 },
    })
    expect(parseAction({ action: 'preset', slot: 40 })).toEqual({
      action: { action: 'preset', slot: 40 },
    })
    expect(parseAction({ action: 'preset', slot: 0 })).toEqual({ error: 'invalid preset slot' })
    expect(parseAction({ action: 'preset', slot: 41 })).toEqual({ error: 'invalid preset slot' })
  })

  it('accepts a sleep timer between zero and one day', () => {
    expect(parseAction({ action: 'sleep', seconds: 0 })).toEqual({
      action: { action: 'sleep', seconds: 0 },
    })
    expect(parseAction({ action: 'sleep', seconds: 60 })).toEqual({
      action: { action: 'sleep', seconds: 60 },
    })
    expect(parseAction({ action: 'sleep', seconds: -1 })).toEqual({ error: 'invalid sleep timer' })
    expect(parseAction({ action: 'sleep', seconds: 86_401 })).toEqual({
      error: 'invalid sleep timer',
    })
  })

  it('accepts an output mode between one and ninety-nine', () => {
    expect(parseAction({ action: 'output', hardware: 1 })).toEqual({
      action: { action: 'output', hardware: 1 },
    })
    expect(parseAction({ action: 'output', hardware: 0 })).toEqual({ error: 'invalid output mode' })
    expect(parseAction({ action: 'output', hardware: 100 })).toEqual({
      error: 'invalid output mode',
    })
  })

  it('accepts an eq flag and rejects anything else', () => {
    expect(parseAction({ action: 'eq', enabled: false })).toEqual({
      action: { action: 'eq', enabled: false },
    })
    expect(parseAction({ action: 'eq', enabled: 1 })).toEqual({ error: 'invalid eq flag' })
  })

  it('accepts an eq preset name of one to forty characters', () => {
    expect(parseAction({ action: 'eqPreset', name: 'Rock' })).toEqual({
      action: { action: 'eqPreset', name: 'Rock' },
    })
    expect(parseAction({ action: 'eqPreset', name: '' })).toEqual({ error: 'invalid eq preset' })
    expect(parseAction({ action: 'eqPreset', name: 'x'.repeat(41) })).toEqual({
      error: 'invalid eq preset',
    })
  })

  it.each(eqBandNames)('accepts the writable band %s', band => {
    expect(parseAction({ action: 'eqBand', band, value: 3 })).toEqual({
      action: { action: 'eqBand', band, value: 3 },
    })
  })

  it('rejects an eq band the firmware does not name', () => {
    expect(parseAction({ action: 'eqBand', band: 'band40hz', value: 3 })).toEqual({
      error: 'invalid eq band',
    })
    expect(parseAction({ action: 'eqBand', band: 3, value: 3 })).toEqual({
      error: 'invalid eq band',
    })
  })

  it('accepts an eq gain up to twelve decibels and keeps the decimal', () => {
    expect(parseAction({ action: 'eqBand', band: 'band31hz', value: -12 })).toEqual({
      action: { action: 'eqBand', band: 'band31hz', value: -12 },
    })
    expect(parseAction({ action: 'eqBand', band: 'band31hz', value: 12 })).toEqual({
      action: { action: 'eqBand', band: 'band31hz', value: 12 },
    })
    expect(parseAction({ action: 'eqBand', band: 'band31hz', value: 6.04 })).toEqual({
      action: { action: 'eqBand', band: 'band31hz', value: 6.04 },
    })
  })

  it('rejects an eq gain outside the measured range or not a number', () => {
    expect(parseAction({ action: 'eqBand', band: 'band31hz', value: 12.1 })).toEqual({
      error: 'eq gain outside -12..12 dB',
    })
    expect(parseAction({ action: 'eqBand', band: 'band31hz', value: Number.NaN })).toEqual({
      error: 'invalid eq gain',
    })
    expect(parseAction({ action: 'eqBand', band: 'band31hz', value: '6' })).toEqual({
      error: 'invalid eq gain',
    })
  })

  it('trims a device name and accepts letters, digits, punctuation and spaces', () => {
    expect(parseAction({ action: 'rename', name: '  Kitchen  ' })).toEqual({
      action: { action: 'rename', name: 'Kitchen' },
    })
    expect(parseAction({ action: 'rename', name: "Chambre (d'amis)" })).toEqual({
      action: { action: 'rename', name: "Chambre (d'amis)" },
    })
  })

  it('rejects a device name that is empty, too long or not printable', () => {
    expect(parseAction({ action: 'rename', name: '   ' })).toEqual({ error: 'invalid device name' })
    expect(parseAction({ action: 'rename', name: 'x'.repeat(33) })).toEqual({
      error: 'invalid device name',
    })
    expect(parseAction({ action: 'rename', name: 'a\nb' })).toEqual({
      error: 'invalid device name',
    })
    expect(parseAction({ action: 'rename', name: 'Salon <1>' })).toEqual({
      error: 'invalid device name',
    })
  })

  it.each(['led', 'buttons', 'fade'])('accepts the boolean flag of %s', action => {
    expect(parseAction({ action, on: true })).toEqual({ action: { action, on: true } })
    expect(parseAction({ action, on: 1 })).toEqual({ error: `invalid ${action} flag` })
  })

  it('accepts a balance between minus one and one', () => {
    expect(parseAction({ action: 'balance', value: -1 })).toEqual({
      action: { action: 'balance', value: -1 },
    })
    expect(parseAction({ action: 'balance', value: 0.5 })).toEqual({
      action: { action: 'balance', value: 0.5 },
    })
    expect(parseAction({ action: 'balance', value: 1.01 })).toEqual({
      error: 'balance outside -1..1',
    })
    expect(parseAction({ action: 'balance', value: 'left' })).toEqual({ error: 'invalid balance' })
  })

  it('accepts a maximum volume between one and one hundred', () => {
    expect(parseAction({ action: 'maxVolume', level: 90 })).toEqual({
      action: { action: 'maxVolume', level: 90 },
    })
    expect(parseAction({ action: 'maxVolume', level: 0 })).toEqual({
      error: 'invalid maximum volume',
    })
    expect(parseAction({ action: 'maxVolume', level: 101 })).toEqual({
      error: 'invalid maximum volume',
    })
  })

  it('accepts an http or https stream address and normalises it', () => {
    expect(parseAction({ action: 'url', url: 'https://example.com/radio.mp3' })).toEqual({
      action: { action: 'url', url: 'https://example.com/radio.mp3' },
    })
    expect(parseAction({ action: 'url', url: '  https://example.com/radio.mp3  ' })).toEqual({
      action: { action: 'url', url: 'https://example.com/radio.mp3' },
    })
    expect(parseAction({ action: 'url', url: 'http://example.com:8000/live' })).toEqual({
      action: { action: 'url', url: 'http://example.com:8000/live' },
    })
  })

  it('rejects a stream address the speaker cannot fetch', () => {
    expect(parseAction({ action: 'url', url: '' })).toEqual({ error: 'invalid stream url' })
    expect(parseAction({ action: 'url', url: 'not a url' })).toEqual({
      error: 'invalid stream url',
    })
    expect(parseAction({ action: 'url', url: 'file:///etc/passwd' })).toEqual({
      error: 'stream url must be http or https',
    })
    expect(parseAction({ action: 'url', url: 'javascript:alert(1)' })).toEqual({
      error: 'stream url must be http or https',
    })
    expect(parseAction({ action: 'url', url: `https://example.com/${'x'.repeat(2048)}` })).toEqual({
      error: 'invalid stream url',
    })
  })

  it('rejects an unknown action instead of passing it through', () => {
    expect(parseAction({ action: 'reboot' })).toEqual({ error: 'unknown action reboot' })
  })
})

describe('commandFor', () => {
  it.each([
    ['play', 'setPlayerCmd:resume'],
    ['pause', 'setPlayerCmd:pause'],
    ['toggle', 'setPlayerCmd:onepause'],
    ['stop', 'setPlayerCmd:stop'],
    ['next', 'setPlayerCmd:next'],
    ['prev', 'setPlayerCmd:prev'],
  ] as const)('maps the fixed action %s to its command', (action, command) => {
    expect(commandFor({ action }, device())).toEqual({ command, family: null })
  })

  it('builds a seek command and marks it coalescable', () => {
    expect(commandFor({ action: 'seek', seconds: 90 }, device())).toEqual({
      command: 'setPlayerCmd:seek:90',
      family: 'seek',
    })
  })

  it('refuses a volume above the ceiling the device reports', () => {
    expect(commandFor({ action: 'volume', level: 70 }, device({ maxVolume: 60 }))).toEqual({
      error: 'volume above the device ceiling (60)',
    })
  })

  it('falls back to one hundred when the device reports no ceiling', () => {
    expect(commandFor({ action: 'volume', level: 100 }, device({ maxVolume: null }))).toEqual({
      command: 'setPlayerCmd:vol:100',
      family: 'volume',
    })
  })

  it('maps mute, preset and sleep to their commands', () => {
    expect(commandFor({ action: 'mute', muted: true }, device())).toEqual({
      command: 'setPlayerCmd:mute:1',
      family: null,
    })
    expect(commandFor({ action: 'mute', muted: false }, device())).toEqual({
      command: 'setPlayerCmd:mute:0',
      family: null,
    })
    expect(commandFor({ action: 'preset', slot: 2 }, device())).toEqual({
      command: 'MCUKeyShortClick:2',
      family: null,
    })
    expect(commandFor({ action: 'sleep', seconds: 60 }, device())).toEqual({
      command: 'setShutdown:60',
      family: null,
    })
  })

  it('refuses an input the device does not report', () => {
    expect(commandFor({ action: 'source', input: 'optical' }, device())).toEqual({
      command: 'setPlayerCmd:switchmode:optical',
      family: null,
    })
    expect(commandFor({ action: 'source', input: 'bluetooth' }, device())).toEqual({
      error: 'input not available: bluetooth',
    })
  })

  it('refuses an output mode the device does not report', () => {
    expect(commandFor({ action: 'output', hardware: 1 }, device())).toEqual({
      command: 'setAudioOutputHardwareMode:1',
      family: null,
    })
    expect(commandFor({ action: 'output', hardware: 3 }, device())).toEqual({
      error: 'output not available: 3',
    })
  })

  it('maps the equalizer switch and refuses an unknown preset', () => {
    expect(commandFor({ action: 'eq', enabled: true }, device())).toEqual({
      command: 'EQOn',
      family: null,
    })
    expect(commandFor({ action: 'eq', enabled: false }, device())).toEqual({
      command: 'EQOff',
      family: null,
    })
    expect(commandFor({ action: 'eqPreset', name: 'Rock' }, device())).toEqual({
      command: 'EQLoad:Rock',
      family: null,
    })
    expect(commandFor({ action: 'eqPreset', name: 'Jazz' }, device())).toEqual({
      error: 'unknown eq preset: Jazz',
    })
  })

  it('refuses an eq band write when the source is unknown', () => {
    const state = device({ eq: { ...device().eq, source: '' } })
    expect(commandFor({ action: 'eqBand', band: 'band31hz', value: 3 }, state)).toEqual({
      error: 'eq source unknown',
    })
  })

  it('writes an eq band against the reported source, rounded to the tenth', () => {
    const result = commandFor({ action: 'eqBand', band: 'band31hz', value: 6.04 }, device())
    if ('error' in result) throw new Error(result.error)
    expect(result.family).toBe('eq-band')
    const payload = JSON.parse(result.command.slice('EQSetLV2SourceBand:'.length))
    expect(payload).toEqual({
      source_name: 'wifi',
      pluginURI: 'http://moddevices.com/plugins/caps/Eq10HP',
      channelMode: 'Stereo',
      EQBand: [{ param_name: 'band31hz', value: 6 }],
    })
  })

  it('maps the device name, the LEDs, the buttons, the fade and the maximum volume', () => {
    expect(commandFor({ action: 'rename', name: 'Kitchen' }, device())).toEqual({
      command: 'setDeviceName:Kitchen',
      family: null,
    })
    expect(commandFor({ action: 'led', on: true }, device())).toEqual({
      command: 'LED_SWITCH_SET:1',
      family: null,
    })
    expect(commandFor({ action: 'buttons', on: false }, device())).toEqual({
      command: 'Button_Enable_SET:0',
      family: null,
    })
    expect(commandFor({ action: 'fade', on: true }, device())).toEqual({
      command: 'SetFadeFeature:1',
      family: null,
    })
    expect(commandFor({ action: 'maxVolume', level: 90 }, device())).toEqual({
      command: 'setMaxVolume:90',
      family: null,
    })
  })

  it('rounds the balance to the tenth and marks it coalescable', () => {
    expect(commandFor({ action: 'balance', value: 0.5 }, device())).toEqual({
      command: 'setChannelBalance:0.5',
      family: 'balance',
    })
    expect(commandFor({ action: 'balance', value: 0.55 }, device())).toEqual({
      command: 'setChannelBalance:0.6',
      family: 'balance',
    })
  })

  it('pushes a stream address to the player', () => {
    expect(commandFor({ action: 'url', url: 'https://example.com/radio.mp3' }, device())).toEqual({
      command: 'setPlayerCmd:play:https://example.com/radio.mp3',
      family: null,
    })
  })
})

describe('commandOutcome', () => {
  it('reads an unreachable device as a failed write', () => {
    expect(commandOutcome(null)).toEqual({ ok: false, unsupported: false })
  })

  it('reads OK as a success', () => {
    expect(commandOutcome('OK')).toEqual({ ok: true, unsupported: false })
    expect(commandOutcome('  OK  ')).toEqual({ ok: true, unsupported: false })
  })

  it('reads unknown command as an unsupported capability, whatever the case', () => {
    expect(commandOutcome('unknown command')).toEqual({ ok: false, unsupported: true })
    expect(commandOutcome('Unknown Command')).toEqual({ ok: false, unsupported: true })
  })

  it('reads Failed and a JSON failure status as failed writes', () => {
    expect(commandOutcome('Failed')).toEqual({ ok: false, unsupported: false })
    expect(commandOutcome('{"status":"Failed"}')).toEqual({ ok: false, unsupported: false })
    expect(commandOutcome('{"status" : "failed"}')).toEqual({ ok: false, unsupported: false })
  })

  it('reads any other body as a success', () => {
    expect(commandOutcome('{"EQStat":"On"}')).toEqual({ ok: true, unsupported: false })
  })
})
