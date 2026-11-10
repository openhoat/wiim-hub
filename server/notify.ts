import {
  type Finding,
  type FindingId,
  findingSentence,
  isFindingId,
  type Severity,
} from './findings.ts'

// The hub has no mail server and no push service of its own: it posts to a
// webhook, or to ntfy, which is a topic URL. Two channels, one shape.
//
// A finding is evaluated on every poll; an alert is sent when the rule appears,
// not while it stays. That distinction is what keeps a channel worth reading:
// the same fault stated every three seconds is the same event, and a reader
// stops looking after the second message.

export type Alert = {
  // The device as the page names it, falling back to the configured entry: a
  // player that never answered has no name to report.
  device: string
  host: string
  finding: Finding
  at: number
}

export type AlertChannel = {
  name: string
  send: (alert: Alert) => Promise<void>
}

const severityRank: Record<Severity, number> = { info: 0, warn: 1, alert: 2 }

const severityNames: readonly Severity[] = ['info', 'warn', 'alert']

// A short name per rule, used as the title of a message: the sentence carries
// the numbers, the title has to survive a notification bar.
const titles: Record<FindingId, string> = {
  offline: 'player offline',
  weakLink: 'weak radio link',
  wifiDrops: 'Wi-Fi drops',
  ethDrops: 'wired link drops',
  pingFailures: 'failed ping checks',
  abnormalReboots: 'abnormal reboots',
  crashCounters: 'firmware crashes',
  flashWear: 'flash wear',
  hardwareFault: 'hardware fault',
  upnpActionsLost: 'lost UPnP actions',
  eventingDegraded: 'push channel degraded',
  sleepTimer: 'sleep timer running',
}

export const alertTitle = (alert: Alert): string =>
  `${alert.device === '' ? alert.host : alert.device}: ${titles[alert.finding.id]}`

// The webhook body is the whole event, flattened: a consumer that reads only
// the title still gets the rule and the severity, and one that wants to check
// the claim gets the evidence lines the report shows.
export const webhookPayload = (alert: Alert): Record<string, unknown> => ({
  at: new Date(alert.at).toISOString(),
  device: alert.device,
  host: alert.host,
  rule: alert.finding.id,
  severity: alert.finding.severity,
  title: alertTitle(alert),
  message: findingSentence(alert.finding),
  evidence: alert.finding.evidence,
})

// ntfy reads the title and the priority from headers and shows the body as is.
// The priority follows the severity the hub already prints, so a reader can
// sort without parsing the text.
const ntfyPriority: Record<Severity, string> = { alert: 'high', warn: 'default', info: 'low' }

export const ntfyBody = (alert: Alert): string => {
  const lines = [findingSentence(alert.finding), '']
  for (const evidence of alert.finding.evidence) lines.push(`- ${evidence}`)
  if (alert.finding.evidence.length > 0) lines.push('')
  lines.push(
    `Device ${alert.device === '' ? alert.host : alert.device} (${alert.host}). ` +
      `Rule ${alert.finding.id}, severity ${alert.finding.severity}.`
  )
  return lines.join('\n')
}

export const ntfyHeaders = (alert: Alert): Record<string, string> => ({
  title: alertTitle(alert),
  priority: ntfyPriority[alert.finding.severity],
})

// The network seam: a test passes a fake, the hub passes `post`, and neither
// channel knows whether it is talking to HTTP.
export type Post = (url: string, body: string, headers: Record<string, string>) => Promise<void>

// Five seconds is the whole budget: a channel that is slow must not hold the
// other one, and the alert is already late by the time it is sent.
const post: Post = async (url, body, headers) => {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}

export const webhookChannel = (url: string, send: Post = post): AlertChannel => ({
  name: 'webhook',
  send: async alert => {
    await send(url, JSON.stringify(webhookPayload(alert)), {
      'content-type': 'application/json',
    })
  },
})

export const ntfyChannel = (
  url: string,
  { token = '', send = post }: { token?: string; send?: Post } = {}
): AlertChannel => ({
  name: 'ntfy',
  send: async alert => {
    // A protected topic answers 403 without the token: the header is the only
    // difference between a public topic and a private one.
    const headers = ntfyHeaders(alert)
    if (token !== '') headers.authorization = `Bearer ${token}`
    await send(url, ntfyBody(alert), headers)
  },
})

export type NotifierOptions = {
  channels: readonly AlertChannel[]
  // Empty means every rule: the default has to be "tell me about the faults",
  // not "tell me about nothing".
  rules?: readonly FindingId[]
  minSeverity?: Severity
  // How long a rule that cleared stays silent before it may speak again. A
  // weak link that flaps around a threshold is one fault, not one per flap.
  quietMs?: number
  now?: () => number
  log?: (message: string) => void
}

export type Notifier = {
  // The names of the configured channels, for the startup line.
  channels: readonly string[]
  // Called on every poll with the findings of one device. It answers the alerts
  // it decided to send, which is what the tests assert; the sends themselves
  // run in the background so a poll never waits on an HTTP call.
  push: (input: { host: string; device: string; findings: readonly Finding[] }) => Alert[]
}

const defaultQuietMs = 3_600_000

export const createNotifier = ({
  channels,
  rules = [],
  minSeverity = 'warn',
  quietMs = defaultQuietMs,
  now = Date.now,
  log = message => console.log(message),
}: NotifierOptions): Notifier => {
  // The rules holding the floor right now, per device: a rule that is still
  // raised is the same event.
  const open = new Map<string, Set<FindingId>>()
  // When each rule last spoke, per device: the quiet period is the only thing
  // that separates a recurrence from a repetition.
  const paged = new Map<string, Map<FindingId, number>>()
  const floor = severityRank[minSeverity]

  const deliver = async (alert: Alert): Promise<void> => {
    for (const channel of channels) {
      const where = `${alert.finding.id} on ${alert.device === '' ? alert.host : alert.device}`
      try {
        await channel.send(alert)
        log(`wiim-hub: alert sent to ${channel.name} (${where})`)
      } catch (error) {
        // A channel that is down must not silence the other one, and must not
        // reach the poll loop: the next occurrence of the rule is the retry.
        const reason = error instanceof Error ? error.message : String(error)
        log(`wiim-hub: alert refused by ${channel.name} (${where}): ${reason}`)
      }
    }
  }

  const push: Notifier['push'] = ({ host, device, findings }) => {
    const at = now()
    const previous = open.get(host) ?? new Set<FindingId>()
    const current = new Set<FindingId>()
    const last = paged.get(host) ?? new Map<FindingId, number>()
    const alerts: Alert[] = []
    for (const finding of findings) {
      if (rules.length > 0 && rules.includes(finding.id) === false) continue
      if (severityRank[finding.severity] < floor) continue
      current.add(finding.id)
      // Already told: the rule did not clear, so this is not new.
      if (previous.has(finding.id)) continue
      const sentAt = last.get(finding.id)
      if (sentAt !== undefined && at - sentAt < quietMs) continue
      last.set(finding.id, at)
      alerts.push({ device, host, finding, at })
    }
    // A rule the device no longer raises leaves the open set, so a recurrence
    // after it cleared counts as a new event, subject to the quiet period.
    open.set(host, current)
    paged.set(host, last)
    for (const alert of alerts) void deliver(alert)
    return alerts
  }

  return { channels: channels.map(channel => channel.name), push }
}

// `NOTIFY_RULES=offline,hardwareFault` narrows the channel to those two rules.
// An unknown name is reported rather than dropped in silence: a typo would
// otherwise look like a rule that never fires.
export const parseRules = (raw: string): { rules: FindingId[]; unknown: string[] } => {
  const rules: FindingId[] = []
  const unknown: string[] = []
  for (const entry of raw.split(',')) {
    const name = entry.trim()
    if (name === '') continue
    if (isFindingId(name) === false) {
      unknown.push(name)
      continue
    }
    if (rules.includes(name) === false) rules.push(name)
  }
  return { rules, unknown }
}

export const parseSeverity = (raw: string, fallback: Severity = 'warn'): Severity => {
  const value = raw.trim().toLowerCase()
  return severityNames.find(name => name === value) ?? fallback
}

// What the hub uses, from the environment alone: the channels are off until an
// operator gives them an address, and null says so without a fake channel.
export const notifierFromEnv = (env: NodeJS.ProcessEnv = process.env): Notifier | null => {
  const webhook = (env.NOTIFY_WEBHOOK ?? '').trim()
  const ntfy = (env.NOTIFY_NTFY ?? '').trim()
  const token = (env.NOTIFY_NTFY_TOKEN ?? '').trim()
  const channels: AlertChannel[] = [
    ...(webhook === '' ? [] : [webhookChannel(webhook)]),
    ...(ntfy === '' ? [] : [ntfyChannel(ntfy, { token })]),
  ]
  if (channels.length === 0) return null
  const { rules, unknown } = parseRules(env.NOTIFY_RULES ?? '')
  if (unknown.length > 0) {
    console.log(`wiim-hub: notifications ignore unknown rule(s): ${unknown.join(', ')}`)
  }
  const quiet = Number.parseInt((env.NOTIFY_QUIET_MS ?? '').trim(), 10)
  return createNotifier({
    channels,
    rules,
    minSeverity: parseSeverity(env.NOTIFY_MIN_SEVERITY ?? ''),
    quietMs: Number.isFinite(quiet) ? Math.max(0, quiet) : defaultQuietMs,
  })
}
