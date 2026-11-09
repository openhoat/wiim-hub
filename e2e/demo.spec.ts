import { expect, type Page, test } from '@playwright/test'

// Every test starts from the demo's English dark default, whatever the
// browser would have picked: the assertions below read the page, not the
// machine they run on.
const openHub = async (page: Page): Promise<void> => {
  await page.goto('/')
  // Preferences are written once, then the page reloads: an init script would
  // run again on every reload and make the persistence test prove nothing.
  await page.evaluate(() => {
    window.localStorage.setItem('wiim-hub:lang', 'en')
    window.localStorage.setItem('wiim-hub:theme', 'dark')
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Living Room' })).toBeVisible()
}

test('renders one reachable speaker and one offline speaker', async ({ page }) => {
  await openHub(page)

  await expect(page.getByRole('heading', { name: 'Living Room' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Bedroom' })).toBeVisible()
  await expect(page.getByText('WiiM Pro')).toBeVisible()
  await expect(page.getByText('Late Ferry', { exact: true })).toBeVisible()
  await expect(page.getByText('The Harbour Lights')).toBeVisible()
  await expect(page.getByText('playing', { exact: true })).toBeVisible()
  await expect(page.getByText('offline', { exact: true })).toBeVisible()

  // The cover travels through the hub, not from the speaker: the page is https
  // while a player answers plain http.
  const art = page.locator('img[src^="/api/art"]')
  await expect(art.first()).toBeVisible()
  await expect(art.first()).toHaveAttribute('src', /uri=demo%3A%2F%2Fcover%2F/)
})

test('shows the group a speaker drives, and hides the one an offline speaker remembers', async ({
  page,
}) => {
  await openHub(page)

  const chips = page.getByRole('button', { name: /speaker\(s\)/ })
  await expect(chips).toHaveCount(1)

  const chip = page.getByRole('button', { name: /Apartment · 1 speaker\(s\)/ })
  await chip.click()

  const panel = page.locator('[id^="group-panel-"]')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('This speaker drives the group.')).toBeVisible()
  await expect(panel.getByText('Bedroom')).toBeVisible()
  // A member with no address is not claimed offline: nothing confirmed it.
  await expect(panel.getByText('state unknown')).toBeVisible()
})

test('opens the sound card on the curve, the presets and the stream quality', async ({ page }) => {
  await openHub(page)

  await page.getByRole('button', { name: 'Sound, show' }).first().click()
  await expect(page.getByRole('button', { name: 'Sound, hide' }).first()).toBeVisible()

  // Ten bands, the fifth selected by default, and the curve is custom because
  // a demo band was moved by hand.
  await expect(page.getByRole('button', { name: /^-?\d+ (Hz|kHz) [+-]?\d+\.\d dB$/ })).toHaveCount(
    10
  )
  await expect(page.getByRole('button', { name: '500 Hz -1.5 dB' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.getByRole('button', { name: 'Custom' })).toBeVisible()
  await expect(page.getByText('This player reports room correction.')).toBeVisible()

  await expect(page.getByText('96 kHz · 24 bit · 2304 kb/s')).toBeVisible()
})

test('exports the sample history from the diagnostic view', async ({ page }) => {
  await openHub(page)

  await page.getByRole('button', { name: 'Diagnostic' }).click()

  await expect(page.getByRole('heading', { name: 'Living Room' })).toBeVisible()
  await expect(page.getByText('192.0.2.21')).toBeVisible()
  await expect(page.getByText('Demo Wi-Fi').first()).toBeVisible()
  await expect(page.getByText('reachable', { exact: true })).toBeVisible()
  await expect(page.getByText('offline', { exact: true })).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).first().click()
  await page.getByRole('menuitem', { name: 'As CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(
    /^wiim-hub-Living Room-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.csv$/
  )
})

test('states the findings, and says explicitly when there is nothing to report', async ({
  page,
}) => {
  await openHub(page)
  await page.getByRole('button', { name: 'Diagnostic' }).click()

  // The playing speaker reads clean, and the panel shows the counters it read:
  // "no anomaly" is a measurement, not a shrug.
  await expect(page.getByTestId('findings-empty')).toHaveText('No anomaly detected')
  await expect(page.getByText(/RSSI -5\d dBm · SNR 35 dB · 0 Wi-Fi drop/)).toBeVisible()

  // The silent speaker gets one alert, whose evidence names the failed polls.
  const offline = page.getByText(/does not answer: 3 consecutive poll failure/).first()
  await expect(offline).toBeVisible()
  await expect(page.getByText('alert', { exact: true })).toBeVisible()
  await offline.click()
  await expect(page.getByText(/last poll failed, 3 failure/)).toBeVisible()

  // The report is English, findings included, and it downloads as Markdown.
  const response = await page.request.get('/api/report?host=192.0.2.22')
  expect(response.ok()).toBe(true)
  const report: { markdown: string } = await response.json()
  expect(report.markdown).toContain('## Findings')
  expect(report.markdown).toContain('The player does not answer: 3 consecutive poll failure(s).')
  // An offline player is not probed, and the report says so instead of printing
  // an empty table a reader would take for a model without capabilities.
  expect(report.markdown).toContain('Not probed: the player was offline')
  expect(report.markdown).toContain('Probe path: `192.0.2.22` over https.')

  const speaking = await page.request.get('/api/report?host=192.0.2.21')
  const inventory: { markdown: string } = await speaking.json()
  expect(inventory.markdown).toContain('## Capability inventory')
  expect(inventory.markdown).toContain('| `getStatusEx` | identity | supported |')
  expect(inventory.markdown).toContain('| `getModeRename` | inputs | failed | `Failed` |')
  expect(inventory.markdown).toContain('| `getInfo` | legacy | unsupported | `unknown command` |')
  expect(inventory.markdown).toContain('| `getAllRoutines` | routines | empty | `empty body` |')

  // The guided checks come before the inventory: the answer to the user first,
  // the raw capability table after it.
  expect(inventory.markdown).toContain('## Guided checks')
  expect(inventory.markdown).toContain('- **No sound**: all 6 check(s) passed.')
  expect(inventory.markdown).toContain('- **Cannot join a group**: all 4 check(s) passed.')
  expect(inventory.markdown.indexOf('## Guided checks')).toBeLessThan(
    inventory.markdown.indexOf('## Capability inventory')
  )
  // An offline speaker stops every flow at the same first check.
  expect(report.markdown).toContain('- **No sound**: fail at `offline`')
  expect(report.markdown).toContain('The player does not answer: 3 consecutive poll failure(s).')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download the report' }).first().click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^wiim-hub-Living Room-.*\.md$/)
})

test('shows an external input as a source instead of an empty player', async ({ page }) => {
  // The demo models network playback only. The optical payload measured on the
  // reference player (mode 43, real transport state, no track, and the position
  // residue the firmware keeps sending) is patched into a real /api/state
  // answer, so the rest of the card still comes from the demo.
  const state: { devices: Record<string, unknown>[] } = await (
    await page.request.get('/api/state')
  ).json()
  const optical = {
    ...state.devices[0],
    status: 'stop',
    mode: '43',
    input: 'optical',
    title: '',
    artist: '',
    album: '',
    albumArt: '',
    source: '',
    curposMs: 25_318,
    totalMs: 137_000,
  }
  await page.route('**/api/state', route =>
    route.fulfill({ json: { ...state, devices: [optical] } })
  )

  await openHub(page)

  await expect(page.getByText('Optical', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('stopped', { exact: true })).toBeVisible()
  await expect(page.getByText('Nothing playing')).toHaveCount(0)
  // No media means no position: the residue must not become a seek bar.
  await expect(page.getByRole('slider', { name: 'Position' })).toHaveCount(0)
})

test('walks the four guided flows, cheapest question first', async ({ page }) => {
  await openHub(page)
  await page.getByRole('button', { name: 'Diagnostic' }).click()

  // One diagnostic card per speaker: scope to the reachable one.
  const card = page.getByTestId('device-192.0.2.21')
  await expect(card.getByText('Guided checks')).toBeVisible()

  // Four flows as tabs, the ones with something to say marked, and the first
  // flow selected by default.
  await expect(card.getByRole('tab')).toHaveCount(4)
  await expect(card.getByRole('tab', { name: 'No sound' })).toHaveAttribute('aria-selected', 'true')

  // A clean flow reads as positive facts, not as anomalies reworded: the mute
  // and volume rows describe the healthy state.
  await expect(card.getByText('The player is not muted.')).toBeVisible()
  await expect(card.getByText('The volume is 44.')).toBeVisible()
  await expect(card.getByText('No anomaly on this flow')).toBeVisible()

  // Another flow is a different reading: the link, then the counters.
  await card.getByRole('tab', { name: 'It drops' }).click()
  // The demo drifts the RSSI on every tick: assert the sentence's shape, not a
  // value that moves between the render and the assertion.
  await expect(card.getByText(/The radio link reads -\d+ dBm, 35 dB SNR\./)).toBeVisible()
  await expect(card.getByText('The Wi-Fi link is stable.')).toBeVisible()
})

test('stops a guided flow at its first anomaly on an offline speaker', async ({ page }) => {
  await openHub(page)
  await page.getByRole('button', { name: 'Diagnostic' }).click()

  // The offline speaker answers nothing: every flow stops on the same first
  // check, and the panel says the reading stopped instead of "all clear".
  const guides = page.getByTestId('device-192.0.2.22').getByTestId('guides-panel')
  await expect(guides.getByRole('tab')).toHaveCount(4)
  await expect(
    guides.getByText('The player does not answer: 3 consecutive poll failure(s).')
  ).toBeVisible()
  await expect(
    guides.getByText('The flow stops at the first anomaly: that row is the last one.')
  ).toBeVisible()
  await expect(guides.getByText('No anomaly on this flow')).toHaveCount(0)
})

test('keeps a volume written from the page across a poll', async ({ page }) => {
  await openHub(page)

  const volume = page.getByRole('slider', { name: 'Volume' }).first()
  await expect(volume).toHaveValue('44')
  await volume.press('ArrowRight')
  await expect(volume).toHaveValue('45')

  // One poll is three seconds: the value must survive it, which is what proves
  // the write reached the state instead of only the optimistic override.
  await page.waitForTimeout(4000)
  await expect(volume).toHaveValue('45')

  const response = await page.request.get('/api/state')
  expect(response.ok()).toBe(true)
  const state: { devices: { name: string; volume: number | null }[] } = await response.json()
  expect(state.devices.find(device => device.name === 'Living Room')?.volume).toBe(45)
})

test('remembers the view, the language and the theme', async ({ page }) => {
  await openHub(page)

  await page.getByRole('button', { name: 'Diagnostic' }).click()
  await expect(page.getByText('Fields').first()).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Diagnostic' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.getByText('Fields').first()).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('menuitemradio', { name: 'Français' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await expect(page.getByText('Champs').first()).toBeVisible()

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await expect(page.getByText('Champs').first()).toBeVisible()

  await page.getByRole('button', { name: 'Réglages' }).click()
  await page.getByRole('menuitemradio', { name: 'Clair' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('lists the addresses it polls, and says which ones it does not own', async ({ page }) => {
  await openHub(page)

  await page.getByRole('button', { name: 'Devices' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('192.0.2.21')).toBeVisible()
  await expect(dialog.getByText('192.0.2.22')).toBeVisible()

  // The demo fleet is fixed, like a seed from the environment: the list is
  // readable, and it says where the entries come from instead of offering an
  // edit that would not persist.
  await expect(dialog.getByText('from the environment')).toHaveCount(2)
  await expect(dialog.getByRole('button', { name: 'Remove' })).toHaveCount(0)

  // A write is refused with the reason, not silently dropped.
  await dialog.getByLabel('Address to add').fill('192.0.2.99')
  await dialog.getByRole('button', { name: 'Add' }).click()
  await expect(dialog.getByText('The hub refused: the demo does not manage hosts')).toBeVisible()
})

test('opens on the cached shell when the network is gone', async ({ page, context }) => {
  await openHub(page)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)

  // The worker, not the HTTP cache, has to answer: the browser cache is emptied
  // before the network goes away, otherwise this test would pass on a shell the
  // worker never stored.
  const session = await context.newCDPSession(page)
  await session.send('Network.clearBrowserCache')
  await context.setOffline(true)
  await page.reload({ waitUntil: 'load' })

  // The document, its bundle and its icons all came from the cache.
  await expect(page.getByRole('heading', { name: 'Living Room' })).toBeVisible()
  await expect(page.getByText('Hub unreachable')).toBeVisible()
  await context.setOffline(false)

  // And the API was never part of it: the page kept the last state it received
  // and dates it, instead of showing a cached answer as the live one.
  await expect(page.getByText(/Last state received/)).toBeVisible()
})

test('keeps the last state it received, dated, when the hub goes quiet', async ({ page }) => {
  await openHub(page)
  await expect(page.getByText('Late Ferry', { exact: true })).toBeVisible()

  await page.route('**/api/state*', route => route.abort())
  await expect(page.getByText('Hub unreachable')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/Last state received .* ago/)).toBeVisible()
  await expect(page.getByText('Late Ferry', { exact: true })).toBeVisible()
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('stacks the cards and folds the view labels to icons', async ({ page }) => {
    await openHub(page)

    // The labels are hidden below the sm breakpoint; the buttons keep their
    // accessible name, so the icon alone is still announced.
    await expect(page.getByRole('button', { name: 'Now playing' }).locator('span')).toBeHidden()
    await expect(page.getByText('1 of 2 online')).toBeHidden()

    const livingRoom = await page.getByRole('heading', { name: 'Living Room' }).boundingBox()
    const bedroom = await page.getByRole('heading', { name: 'Bedroom' }).boundingBox()
    expect(livingRoom).not.toBeNull()
    expect(bedroom).not.toBeNull()
    expect(bedroom?.y ?? 0).toBeGreaterThan(livingRoom?.y ?? 0)
  })
})
