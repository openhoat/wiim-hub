import { describe, expect, it, vi } from 'vitest'
import type { Finding } from './findings.ts'
import {
  type Alert,
  type AlertChannel,
  alertTitle,
  createNotifier,
  notifierFromEnv,
  ntfyBody,
  ntfyChannel,
  ntfyHeaders,
  parseRules,
  parseSeverity,
  webhookChannel,
  webhookPayload,
} from './notify.ts'

// The sends run in the background so a poll never waits on an HTTP call, which
// means a test has to let their microtasks drain before reading what arrived.
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const finding = (id: Finding['id'], severity: Finding['severity'] = 'warn'): Finding => ({
  id,
  severity,
  values: { count: 3, minutes: 12 },
  evidence: ['getNetworkHealth: wifiDrops 3'],
})

const alert = (id: Finding['id'] = 'wifiDrops', severity: Finding['severity'] = 'warn'): Alert => ({
  device: 'Kitchen',
  host: '192.0.2.10',
  finding: finding(id, severity),
  at: Date.UTC(2026, 10, 10, 12, 0, 0),
})

const recorder = (name = 'webhook'): AlertChannel & { sent: Alert[] } => {
  const sent: Alert[] = []
  return {
    name,
    sent,
    send: async entry => {
      sent.push(entry)
    },
  }
}

describe('createNotifier', () => {
  it('sends a rule when it appears, not on every poll', async () => {
    const channel = recorder()
    let at = 0
    const notifier = createNotifier({ channels: [channel], now: () => at })
    const input = { host: 'kitchen', device: 'Kitchen', findings: [finding('weakLink')] }
    expect(notifier.push(input)).toHaveLength(1)
    await flush()
    at = 3000
    expect(notifier.push(input)).toHaveLength(0)
    await flush()
    expect(channel.sent).toHaveLength(1)
    expect(notifier.channels).toEqual(['webhook'])
  })

  it('keeps the info rules silent under the default floor', () => {
    const channel = recorder()
    const notifier = createNotifier({ channels: [channel] })
    expect(
      notifier.push({
        host: 'kitchen',
        device: 'Kitchen',
        findings: [finding('sleepTimer', 'info')],
      })
    ).toHaveLength(0)
    const loud = createNotifier({ channels: [channel], minSeverity: 'info' })
    expect(
      loud.push({ host: 'kitchen', device: 'Kitchen', findings: [finding('sleepTimer', 'info')] })
    ).toHaveLength(1)
  })

  it('narrows to the configured rules, an empty list meaning all of them', () => {
    const channel = recorder()
    const notifier = createNotifier({ channels: [channel], rules: ['offline'] })
    const input = {
      host: 'kitchen',
      device: 'Kitchen',
      findings: [finding('weakLink'), finding('offline', 'alert')],
    }
    expect(notifier.push(input).map(entry => entry.finding.id)).toEqual(['offline'])
    const all = createNotifier({ channels: [channel] })
    expect(all.push(input)).toHaveLength(2)
  })

  it('holds a rule that cleared and came back inside the quiet period', () => {
    const channel = recorder()
    let at = 0
    const notifier = createNotifier({ channels: [channel], now: () => at, quietMs: 3_600_000 })
    const raised = { host: 'kitchen', device: 'Kitchen', findings: [finding('weakLink')] }
    const cleared = { ...raised, findings: [] }
    expect(notifier.push(raised)).toHaveLength(1)
    notifier.push(cleared)
    at = 600_000
    expect(notifier.push(raised)).toHaveLength(0)
    // Cleared again, and this time the hour since the first message has passed:
    // a recurrence after the quiet period is worth a second look.
    notifier.push(cleared)
    at = 3_600_000
    expect(notifier.push(raised)).toHaveLength(1)
  })

  it('keeps the other channel and the log when one of them fails', async () => {
    const broken: AlertChannel = {
      name: 'webhook',
      send: async () => {
        throw new Error('HTTP 500')
      },
    }
    const channel = recorder('ntfy')
    const log = vi.fn()
    const notifier = createNotifier({ channels: [broken, channel], log })
    notifier.push({ host: 'kitchen', device: 'Kitchen', findings: [finding('offline', 'alert')] })
    await flush()
    expect(channel.sent).toHaveLength(1)
    const lines = log.mock.calls.map(call => call[0])
    expect(lines).toContain('wiim-hub: alert refused by webhook (offline on Kitchen): HTTP 500')
    expect(lines).toContain('wiim-hub: alert sent to ntfy (offline on Kitchen)')
  })
})

describe('message shapes', () => {
  it('flattens the event into the webhook body', () => {
    expect(webhookPayload(alert())).toEqual({
      at: '2026-11-10T12:00:00.000Z',
      device: 'Kitchen',
      host: '192.0.2.10',
      rule: 'wifiDrops',
      severity: 'warn',
      title: 'Kitchen: Wi-Fi drops',
      message: expect.stringContaining('The Wi-Fi dropped 3 time(s)'),
      evidence: ['getNetworkHealth: wifiDrops 3'],
    })
    // A player that never answered has no name: the entry itself is the name.
    expect(alertTitle({ ...alert(), device: '' })).toBe('192.0.2.10: Wi-Fi drops')
  })

  it('writes the ntfy body as text, with the evidence and the rule', () => {
    const body = ntfyBody(alert())
    expect(body).toContain('The Wi-Fi dropped 3 time(s)')
    expect(body).toContain('- getNetworkHealth: wifiDrops 3')
    expect(body).toContain('Device Kitchen (192.0.2.10). Rule wifiDrops, severity warn.')
    expect(ntfyHeaders(alert()).priority).toBe('default')
    expect(ntfyHeaders(alert('offline', 'alert')).priority).toBe('high')
    expect(ntfyHeaders(alert('sleepTimer', 'info')).priority).toBe('low')
  })

  it('posts the payload as JSON to the webhook', async () => {
    const calls: { url: string; body: string; headers: Record<string, string> }[] = []
    const channel = webhookChannel('https://hooks.example/wiim', async (url, body, headers) => {
      calls.push({ url, body, headers })
    })
    await channel.send(alert())
    expect(calls[0].url).toBe('https://hooks.example/wiim')
    expect(calls[0].headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(calls[0].body)).toMatchObject({ rule: 'wifiDrops', severity: 'warn' })
  })

  it('posts text and headers to the ntfy topic, with the token when there is one', async () => {
    const calls: { url: string; body: string; headers: Record<string, string> }[] = []
    const send = async (
      url: string,
      body: string,
      headers: Record<string, string>
    ): Promise<void> => {
      calls.push({ url, body, headers })
    }
    await ntfyChannel('https://ntfy.example/wiim', { token: 't0k', send }).send(alert())
    expect(calls[0].url).toBe('https://ntfy.example/wiim')
    expect(calls[0].headers).toEqual({
      title: 'Kitchen: Wi-Fi drops',
      priority: 'default',
      authorization: 'Bearer t0k',
    })
    await ntfyChannel('https://ntfy.example/wiim', { send }).send(alert())
    expect(calls[1].headers).not.toHaveProperty('authorization')
  })
})

describe('configuration', () => {
  it('reads a rule list, deduplicated, and reports what it does not know', () => {
    expect(parseRules('offline, hardwareFault ,offline')).toEqual({
      rules: ['offline', 'hardwareFault'],
      unknown: [],
    })
    expect(parseRules('offline,offlin,')).toEqual({ rules: ['offline'], unknown: ['offlin'] })
    expect(parseRules('')).toEqual({ rules: [], unknown: [] })
  })

  it('reads a severity and falls back rather than failing', () => {
    expect(parseSeverity('ALERT')).toBe('alert')
    expect(parseSeverity(' info ')).toBe('info')
    expect(parseSeverity('loud')).toBe('warn')
    expect(parseSeverity('')).toBe('warn')
    expect(parseSeverity('loud', 'alert')).toBe('alert')
  })

  it('is off until a channel is given an address', () => {
    expect(notifierFromEnv({})).toBeNull()
  })

  it('lists the configured channels and warns about an unknown rule', () => {
    const log = vi.spyOn(console, 'log').mockReturnValue(undefined)
    const notifier = notifierFromEnv({
      NOTIFY_WEBHOOK: 'https://hooks.example/wiim',
      NOTIFY_NTFY: 'https://ntfy.example/wiim',
      NOTIFY_RULES: 'offline,offlin',
    })
    expect(notifier?.channels).toEqual(['webhook', 'ntfy'])
    expect(log).toHaveBeenCalledWith('wiim-hub: notifications ignore unknown rule(s): offlin')
    log.mockRestore()
  })
})
