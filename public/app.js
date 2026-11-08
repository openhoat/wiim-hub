const refreshMs = 3000
const progressMs = 1000
const supported = ['en', 'fr']
const fallback = 'en'
const weakRssi = -70
const templates = {
  user: document.querySelector('#card-user'),
  diagnostic: document.querySelector('#card-diagnostic'),
}
const container = document.querySelector('#devices')
const empty = document.querySelector('#empty')
const stamp = document.querySelector('#stamp')
const discoverButton = document.querySelector('#discover')
const langSelect = document.querySelector('#lang')
const themeSelect = document.querySelector('#theme')
const viewButtons = [...document.querySelectorAll('.views [data-view]')]

// Preferences live in localStorage and never leak to the server: the hub stays
// a passive observer, the browser keeps its own view settings.
const store = {
  read: (key) => {
    try {
      return localStorage.getItem(`wiim-hub:${key}`)
    } catch {
      return null
    }
  },
  write: (key, value) => {
    try {
      localStorage.setItem(`wiim-hub:${key}`, value)
    } catch {
      // private mode, preferences stay in memory
    }
  },
}

const settings = {
  lang: store.read('lang') ?? 'auto',
  theme: store.read('theme') ?? 'auto',
  // The user view answers "what is playing"; the diagnostic view answers "why
  // is it not". Same data, two audiences, so the default stays the calm one.
  view: store.read('view') === 'diagnostic' ? 'diagnostic' : 'user',
}

let locale = fallback
let messages = {}
let lastState = null
const expanded = new Set()

const pickLocale = () => {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of tags) {
    const base = String(tag ?? '').toLowerCase().split(/[-_]/)[0]
    if (supported.includes(base)) return base
  }
  return fallback
}

const loadMessages = async (tag) => {
  const response = await fetch(`/locales/${tag}.json`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`missing locale ${tag}`)
  return response.json()
}

// Minimal i18n: labels live in public/locales/<tag>.json, values interpolate
// named placeholders. An unknown key prints itself, so a missing translation
// shows up in the page instead of breaking the render.
const t = (key, vars = {}) => {
  const value = key
    .split('.')
    .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), messages)
  if (typeof value !== 'string') return key
  return value.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''))
}

const applyI18n = (root, vars = {}) => {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n, vars)
  }
}

const applyTheme = () => {
  if (settings.theme === 'auto') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = settings.theme
}

const applyView = () => {
  for (const button of viewButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.view === settings.view))
  }
  document.body.dataset.view = settings.view
}

const applyStatic = () => {
  document.documentElement.lang = locale
  applyI18n(document, { poll: refreshMs / 1000 })
  applyView()
}

const clock = (at) => new Date(at).toLocaleTimeString(locale)

const ago = (at) => {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  return seconds < 60 ? t('secondsAgo', { n: seconds }) : t('minutesAgo', { n: Math.round(seconds / 60) })
}

const duration = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

// Playback states come from the device as short tokens (`play`, `pause`,
// `none`): they are translated, and an unknown token shows as is.
const statusLabel = (status) => {
  if (status === '') return t('statuses.none')
  const value = messages.statuses?.[status]
  return typeof value === 'string' ? value : status
}

// The device reports a position at poll time: between two polls the browser
// extrapolates while playing, so the bar moves instead of stepping.
const positionOf = (device) => {
  if (device.curposMs === null || device.totalMs === null) return null
  const elapsed = device.status === 'play' && device.updatedAt !== null ? Date.now() - device.updatedAt : 0
  return Math.min(device.totalMs, device.curposMs + elapsed)
}

const fill = (dl, rows) => {
  dl.replaceChildren()
  for (const [label, value] of rows) {
    const term = document.createElement('dt')
    term.textContent = label
    const definition = document.createElement('dd')
    definition.textContent = value
    dl.append(term, definition)
  }
}

const sparkline = (svg, samples) => {
  svg.setAttribute('aria-label', t('rssiChart'))
  const points = samples.filter((sample) => typeof sample.rssi === 'number').map((sample) => sample.rssi)
  svg.replaceChildren()
  if (points.length < 2) return
  const min = -90
  const max = -30
  const width = 320
  const height = 64
  const step = width / (points.length - 1)
  const y = (value) => {
    const clamped = Math.min(max, Math.max(min, value))
    return height - 4 - ((clamped - min) / (max - min)) * (height - 8)
  }
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  polyline.setAttribute(
    'points',
    points.map((value, index) => `${(index * step).toFixed(1)},${y(value).toFixed(1)}`).join(' '),
  )
  polyline.setAttribute('fill', 'none')
  polyline.setAttribute('stroke', '#4cc38a')
  polyline.setAttribute('stroke-width', '1.5')
  svg.append(polyline)
}

const eventLabel = (kind) => {
  const value = messages.events?.[kind]
  return typeof value === 'string' ? value : kind
}

// Events carry machine values (status tokens, track titles), never a rendered
// sentence: the transition is formatted here so the log follows the language.
const eventText = (event) => {
  if (event.kind === 'status') return `${statusLabel(event.from)} → ${statusLabel(event.to)}`
  if (event.kind === 'track') return event.to
  return ''
}

const csvOf = (device) => {
  const rows = [['time', 'rssi_dbm', 'volume', 'state', 'online']]
  for (const sample of device.samples) {
    rows.push([
      new Date(sample.t).toISOString(),
      sample.rssi ?? '',
      sample.volume ?? '',
      sample.status ?? '',
      sample.online ? '1' : '0',
    ])
  }
  return rows.map((row) => row.join(',')).join('\n')
}

const download = (filename, content, type) => {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const renderArt = (card, device) => {
  const art = card.querySelector('.art')
  if (!/^https?:\/\//.test(device.albumArt)) return
  art.src = device.albumArt
  art.hidden = false
  art.onerror = () => {
    art.hidden = true
  }
}

const renderProgress = (card, device) => {
  const progress = card.querySelector('.progress')
  if (progress === null) return
  const position = positionOf(device)
  if (position === null || device.totalMs === null || device.totalMs <= 0) return
  progress.hidden = false
  card.querySelector('.times').textContent = `${duration(position)} / ${duration(device.totalMs)}`
  card.querySelector('.fill').style.width = `${Math.round((position / device.totalMs) * 100)}%`
}

const renderDetail = (card, device) => {
  const body = card.querySelector('.samples tbody')
  body.replaceChildren()
  for (const sample of device.samples.slice(-30).reverse()) {
    const row = document.createElement('tr')
    const cells = [
      clock(sample.t),
      sample.rssi === null ? '' : `${sample.rssi}`,
      sample.volume === null ? '' : `${sample.volume}`,
      sample.status || '',
      sample.online ? t('up') : t('down'),
    ]
    for (const value of cells) {
      const cell = document.createElement('td')
      cell.textContent = value
      row.append(cell)
    }
    body.append(row)
  }
  const exportButton = card.querySelector('.export')
  exportButton.onclick = () => {
    const stampName = new Date().toISOString().replace(/[:.]/g, '-')
    download(`wiim-hub-${device.name || device.ip}-${stampName}.csv`, csvOf(device), 'text/csv;charset=utf-8')
  }
}

// Shared head: identity first, then the badges that qualify it. A stale
// address is invisible here, the device name is what the reader recognises.
const renderHead = (card, device) => {
  card.querySelector('.head .dot').classList.toggle('on', device.online)
  card.querySelector('.head .name').textContent = device.name
  card.querySelector('.head .model').textContent = device.model || ''
  const source = card.querySelector('.head .source')
  source.textContent = device.source
  source.hidden = device.source === ''
}

const renderUserCard = (device) => {
  const card = templates.user.content.firstElementChild.cloneNode(true)
  applyI18n(card)
  card.dataset.key = device.ip
  renderHead(card, device)
  const offline = card.querySelector('.badge.offline')
  offline.hidden = device.online
  renderArt(card, device)
  card.querySelector('.title').textContent = device.title || t('noPlayback')
  card.querySelector('.who').textContent = [device.artist, device.album].filter(Boolean).join(' · ')
  renderProgress(card, device)

  const state = card.querySelector('.chip.state')
  state.textContent = statusLabel(device.status)
  state.classList.toggle('live', device.status === 'play')
  const volume = card.querySelector('.chip.volume')
  volume.textContent = device.volume === null ? '' : t('chipVolume', { value: device.volume })
  volume.hidden = device.volume === null
  const group = card.querySelector('.chip.group')
  group.hidden = device.slaves === 0
  group.textContent = t('groupMembers', { n: device.slaves })
  return card
}

const renderDiagnosticCard = (device) => {
  const card = templates.diagnostic.content.firstElementChild.cloneNode(true)
  const unknown = t('unknown')
  applyI18n(card)
  card.dataset.key = device.ip
  renderHead(card, device)
  card.querySelector('.track .title').textContent = device.title || t('noPlayback')
  card.querySelector('.track .who').textContent = [device.artist, device.album].filter(Boolean).join(' · ')

  const group = [device.group, device.slaves > 0 ? t('groupMembers', { n: device.slaves }) : '']
    .filter(Boolean)
    .join(' · ')
  fill(card.querySelector('.grid'), [
    [t('labels.address'), device.ip],
    [t('labels.firmware'), [device.firmware, device.release].filter(Boolean).join(' · ') || unknown],
    [t('labels.network'), device.ssid || unknown],
    [t('labels.bssid'), device.bssid || unknown],
    [t('labels.source'), device.source || unknown],
    [t('labels.group'), group || t('none')],
    [t('labels.volume'), device.volume === null ? unknown : `${device.volume}`],
    [t('labels.state'), statusLabel(device.status)],
    [t('labels.lastSeen'), device.lastSeen ? ago(device.lastSeen) : t('never')],
    [t('labels.failures'), `${device.errors}`],
  ])
  sparkline(card.querySelector('.spark svg'), device.samples)
  card.querySelector('.rssi').textContent =
    device.rssi === null ? t('rssiUnknown') : t('rssi', { value: device.rssi })

  const alert = card.querySelector('.alert')
  if (!device.online) {
    alert.textContent = t('events.offline')
    alert.classList.add('warn')
  } else if (device.rssi !== null && device.rssi <= weakRssi) {
    alert.textContent = t('weakSignal')
    alert.classList.add('warn')
  }

  const detail = card.querySelector('.detail')
  const detailsButton = card.querySelector('.details')
  const isOpen = expanded.has(device.ip)
  detail.hidden = !isOpen
  detailsButton.textContent = isOpen ? t('hideDetails') : t('details')
  detailsButton.addEventListener('click', () => {
    const open = expanded.has(device.ip)
    if (open) expanded.delete(device.ip)
    else expanded.add(device.ip)
    detail.hidden = open
    detailsButton.textContent = open ? t('details') : t('hideDetails')
  })
  renderDetail(card, device)

  const events = card.querySelector('.events')
  for (const event of device.events.slice(0, 8)) {
    const item = document.createElement('li')
    item.textContent = [clock(event.t), eventLabel(event.kind), eventText(event)].filter(Boolean).join(' · ')
    events.append(item)
  }
  return card
}

const render = (state) => {
  container.replaceChildren()
  container.dataset.view = settings.view
  empty.hidden = state.devices.length > 0
  for (const device of state.devices) {
    container.append(settings.view === 'diagnostic' ? renderDiagnosticCard(device) : renderUserCard(device))
  }
  const offline = state.devices.filter((device) => !device.online).length
  document.title = offline > 0 ? `(${t('offlineCount', { n: offline })}) ${t('title')}` : t('title')
}

const tick = async () => {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' })
    const state = await response.json()
    lastState = state
    render(state)
    stamp.textContent = t('sample', { time: clock(state.ts) })
  } catch {
    stamp.textContent = t('hubDown')
  }
}

// Move the progress bars between two polls without refetching.
const refreshProgress = () => {
  if (lastState === null) return
  const cards = container.children
  for (let index = 0; index < cards.length && index < lastState.devices.length; index += 1) {
    const device = lastState.devices[index]
    const card = cards[index]
    const progress = card.querySelector('.progress')
    if (progress === null || progress.hidden) continue
    const position = positionOf(device)
    if (position === null || device.totalMs === null || device.totalMs === 0) continue
    card.querySelector('.times').textContent = `${duration(position)} / ${duration(device.totalMs)}`
    card.querySelector('.fill').style.width = `${Math.round((position / device.totalMs) * 100)}%`
  }
}

const switchLocale = async () => {
  locale = settings.lang === 'auto' ? pickLocale() : settings.lang
  try {
    messages = await loadMessages(locale)
  } catch {
    locale = fallback
    messages = await loadMessages(fallback).catch(() => ({}))
  }
  applyStatic()
  if (lastState !== null) render(lastState)
}

const switchView = (view) => {
  if (view !== 'user' && view !== 'diagnostic') return
  settings.view = view
  store.write('view', view)
  applyView()
  if (lastState !== null) render(lastState)
}

for (const button of viewButtons) {
  button.addEventListener('click', () => switchView(button.dataset.view))
}

discoverButton.addEventListener('click', async () => {
  discoverButton.disabled = true
  discoverButton.textContent = t('searching')
  try {
    const response = await fetch('/api/discover', { method: 'POST' })
    const result = await response.json()
    discoverButton.textContent = result.added > 0 ? t('added', { count: result.added }) : t('noNewDevice')
    await tick()
  } catch {
    discoverButton.textContent = t('discoveryFailed')
  }
  setTimeout(() => {
    discoverButton.disabled = false
    discoverButton.textContent = t('discover')
  }, 2500)
})

langSelect.addEventListener('change', () => {
  settings.lang = langSelect.value
  store.write('lang', settings.lang)
  void switchLocale()
})

themeSelect.addEventListener('change', () => {
  settings.theme = themeSelect.value
  store.write('theme', settings.theme)
  applyTheme()
})

const boot = async () => {
  langSelect.value = settings.lang
  themeSelect.value = settings.theme
  applyTheme()
  await switchLocale()
  await tick()
  setInterval(() => void tick(), refreshMs)
  setInterval(refreshProgress, progressMs)
}

void boot()
