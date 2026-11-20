import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Page, test } from '@playwright/test'

// The install metadata and the worker are files a release replaces on the
// server; a test that changes them has to put them back, whatever happened in
// between, or the next test inherits a worker nobody published.
const replaceTemporarily = async (
  path: string,
  content: string,
  run: () => Promise<void>
): Promise<void> => {
  const original = readFileSync(path, 'utf8')
  try {
    writeFileSync(path, content)
    await run()
  } finally {
    writeFileSync(path, original)
  }
}

// Every test starts from the demo's English dark default, whatever the
// browser would have picked: the assertions below read the page, not the
// machine they run on.
const openHub = async (page: Page): Promise<void> => {
  // The demo fleet mutates like a real one, so every test starts from the seed:
  // the assertions below read exact levels and track names, and a write a test
  // made through the page would otherwise decide what the next one sees.
  await page.request.post('/api/demo/reset')
  await page.goto('/')
  // Preferences are written once, then the page reloads: an init script would
  // run again on every reload and make the persistence test prove nothing.
  await page.evaluate(() => {
    window.localStorage.setItem('wiim-hub:lang', 'en')
    window.localStorage.setItem('wiim-hub:theme', 'dark')
  })
  await page.reload()
  // A card is what the page shows once the fleet answers: a speaker alone, or a
  // group, which is one card.
  await expect(page.locator('[data-testid^="playing-"]').first()).toBeVisible()
}

test('renders a group as one card, and an offline speaker beside it', async ({ page }) => {
  await openHub(page)

  // The group's name heads the card and the speaker that drives it sits under
  // it: the reader sees one player, as the vendor app shows it.
  const group = page.getByTestId('playing-192.0.2.21')
  await expect(group.getByRole('heading', { level: 2, name: 'Apartment' })).toBeVisible()
  await expect(group.getByText('Living Room · WiiM Pro')).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Bedroom' })).toBeVisible()
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

// The card answers what is playing now; the favourites the speaker saved live in
// that speaker's sheet, one tap away, because the group card carries no tool of
// a single speaker. The demo saves a radio and a YouTube Music playlist on the
// master, and the offline speaker saved nothing, so it gets no trigger at all.
test('offers every favourite the speaker saved, whatever the service', async ({ page }) => {
  await openHub(page)

  // Nothing of the list sits on the card before the sheet is opened, and the
  // trigger is the speaker's own: the group card carries none, the row of the
  // speaker that drives it does.
  await expect(page.getByRole('button', { name: /Sunday Jazz/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Favorites', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Settings for Living Room' }).click()
  const speaker = page.getByRole('dialog', { name: 'Living Room' })

  // The trigger is named after what the sheet holds, and the sheet is not a
  // playlist picker: the radio and the service list are both offered.
  await speaker.getByRole('button', { name: 'Favorites', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Favorites' })
  await expect(sheet.getByRole('button', { name: 'Morning Radio, vTuner · Slot 1' })).toBeVisible()
  await expect(
    sheet.getByRole('button', { name: 'Sunday Jazz, YouTubeMusic · Slot 3' })
  ).toBeVisible()

  // A tap carries the slot number and nothing else: on a service slot the player
  // resolves what it plays. The write is intercepted, because the demo keeps
  // what a preset changed for the rest of the run and the other tests read the
  // track it started with; the answer is the one the route returns.
  let sent: unknown = null
  await page.route('**/api/command?**', async route => {
    sent = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        unsupported: false,
        command: 'MCUKeyShortClick:3',
        body: 'OK',
      }),
    })
  })
  await sheet.getByRole('button', { name: /Sunday Jazz/ }).click()
  await expect(sheet).toHaveCount(0)
  expect(sent).toEqual({ action: 'preset', slot: 3 })
})

// A group plays; its sleep timer, its output, its stream and its presets belong
// to the speakers, not to the group: the card carries the transport and the group
// volume only, and each row opens its speaker's own tools.
test('keeps the tools of a speaker out of the group card', async ({ page }) => {
  await openHub(page)

  const group = page.getByTestId('playing-192.0.2.21')
  await expect(group.getByRole('button', { name: 'Sleep timer', exact: true })).toHaveCount(0)
  await expect(group.getByRole('button', { name: 'Stream URL', exact: true })).toHaveCount(0)
  await expect(group.getByRole('button', { name: 'Favorites', exact: true })).toHaveCount(0)
  await expect(group.getByRole('button', { name: 'Previous' })).toBeVisible()

  // The row of the speaker that drives the group opens them, in its sheet.
  await page.getByRole('button', { name: 'Settings for Living Room' }).click()
  const sheet = page.getByRole('dialog', { name: 'Living Room' })
  await expect(sheet.getByRole('button', { name: 'Sleep timer', exact: true })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Stream URL', exact: true })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Favorites', exact: true })).toBeVisible()

  // A speaker alone still carries its tools on its own card.
  await page.keyboard.press('Escape')
  const solo = page.getByTestId('playing-192.0.2.22')
  await expect(solo.getByRole('button', { name: 'Sleep timer', exact: true })).toBeVisible()
})

test('shows the group a speaker drives, and hides the one an offline speaker remembers', async ({
  page,
}) => {
  await openHub(page)

  // The offline speaker reports a saved group: it keeps its own card and has no
  // chip, since nothing just confirmed that group.
  const chips = page.getByRole('button', { name: /2 speakers$/ })
  await expect(chips).toHaveCount(1)

  const chip = page.getByRole('button', { name: /Apartment · 2 speakers$/ })
  await chip.click()

  const panel = page.locator('[id^="group-panel-"]')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('This speaker drives the group.')).toBeVisible()
  await expect(panel.getByText('Hallway')).toBeVisible()
  await expect(panel.getByText('192.0.2.23')).toBeVisible()
  // A member with no address is not claimed offline: nothing confirmed it.
  await expect(panel.getByText('Bathroom')).toBeVisible()
  await expect(panel.getByText('state unknown')).toBeVisible()
})

// A running group is one player: the speaker that drives it carries the cover,
// the track and the transport, and the speakers that follow it are rows of the
// same card with their own volume. The demo runs that shape natively (Living
// Room drives Apartment, Hallway renders it) and remembers a member it cannot
// poll at all.
test('draws a running group as one card, with its members as rows', async ({ page }) => {
  await openHub(page)

  const group = page.getByTestId('playing-192.0.2.21')
  // One card per group: the member has no card of its own any more.
  await expect(page.locator('[data-testid^="playing-"]')).toHaveCount(2)
  await expect(page.getByTestId('playing-192.0.2.23')).toHaveCount(0)

  // One cover for the whole group, and it belongs to the master.
  await expect(group.locator('img[src^="/api/art"]')).toHaveCount(1)
  await expect(group.getByText('Late Ferry', { exact: true })).toBeVisible()
  await expect(group.getByRole('button', { name: 'Previous' })).toBeVisible()

  // The members are rows of that card: one the fleet polls, with its own
  // volume, and one the master remembers and nothing confirms. The speaker that
  // drives the group is a row too, and comes first: it is the room the others
  // follow, and the level at the top of the card is the group's, not its.
  await expect(group.getByText('Speakers', { exact: true })).toBeVisible()
  await expect(group.getByRole('button', { name: 'Volume of Living Room' })).toContainText('44')
  await expect(group.getByText('WiiM Pro · drives the group')).toBeVisible()
  await expect(group.getByText('Hallway')).toBeVisible()
  await expect(group.getByRole('button', { name: 'Volume of Hallway' })).toContainText('35')
  await expect(group.getByText('Bathroom')).toBeVisible()
  await expect(group.getByText('state unknown')).toBeVisible()
  // Every row is the same row, the master's included: its mute sits next to its
  // volume and silences that speaker alone (measured 20/11, the write leaves by
  // UPnP), while the player above carries the group's mute, named after the
  // group so the two scopes cannot be confused.
  await expect(group.getByRole('button', { name: 'Mute Living Room' })).toBeVisible()
  await expect(group.getByRole('button', { name: 'Mute Apartment' })).toBeVisible()

  // The offline speaker keeps its own card and draws no row of the group.
  const bedroom = page.getByTestId('playing-192.0.2.22')
  await expect(bedroom.getByRole('heading', { level: 2, name: 'Bedroom' })).toBeVisible()
})

// The list folds like a diagnostic card does, and the fold is a preference of
// the browser: a reader who knows the group can keep the card to its player.
test('folds the speakers of a group, and keeps the fold across a reload', async ({ page }) => {
  await openHub(page)

  const group = page.getByTestId('playing-192.0.2.21')
  await expect(group.getByRole('button', { name: 'Volume of Hallway' })).toBeVisible()

  await group.getByRole('button', { name: 'Collapse' }).click()
  await expect(group.getByRole('button', { name: 'Volume of Hallway' })).toHaveCount(0)
  await expect(group.getByRole('button', { name: 'Expand' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )

  await page.reload()
  await expect(page.locator('[data-testid^="playing-"]').first()).toBeVisible()
  await expect(group.getByRole('button', { name: 'Volume of Hallway' })).toHaveCount(0)

  await group.getByRole('button', { name: 'Expand' }).click()
  await expect(group.getByRole('button', { name: 'Volume of Hallway' })).toBeVisible()
})

// The equalizer of a speaker that drives a group lives in that speaker's own
// sheet, with the rest of what the room answers: the group card carries the
// player, and one gesture opens the room.
test('opens the equalizer of a group speaker from its row', async ({ page }) => {
  await openHub(page)

  const group = page.getByTestId('playing-192.0.2.21')
  // The group has no sound card of its own: its equalizer is a gesture away,
  // under the name of the speaker it changes.
  await expect(group.getByRole('button', { name: 'Sound, show' })).toHaveCount(0)
  await group.getByRole('button', { name: 'Settings for Living Room' }).click()

  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Living Room' })).toBeVisible()

  // Ten bands, the fifth selected by default, and the curve is custom because
  // a demo band was moved by hand.
  await expect(sheet.getByRole('button', { name: /^-?\d+ (Hz|kHz) [+-]?\d+\.\d dB$/ })).toHaveCount(
    10
  )
  await expect(sheet.getByRole('button', { name: '500 Hz -1.5 dB' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(sheet.getByRole('button', { name: 'Custom' })).toBeVisible()
  await expect(sheet.getByText('This player reports room correction.')).toBeVisible()

  await expect(sheet.getByText('96 kHz · 24 bit · 2304 kb/s')).toBeVisible()
})

// The source is the speaker's, not the card's: a group is a stream, and only
// the speaker itself has an input to switch. The picker therefore sits in the
// settings of every speaker, the master included, where the vendor app keeps it.
test('switches the source from the settings of its speaker', async ({ page }) => {
  await openHub(page)

  const group = page.getByTestId('playing-192.0.2.21')
  // The player of the card carries no source picker any more. (The output
  // dropdown of the card is named Optical too: the analogue entry is the one
  // that can only come from the missing row.)
  await expect(group.getByRole('button', { name: 'Line in' })).toHaveCount(0)

  await group.getByRole('button', { name: 'Settings for Living Room' }).click()
  const sheet = page.getByRole('dialog')
  // A network stream is the network input: the row lights it rather than
  // leaving every entry looking inactive, which is what a cast used to do.
  const wifi = sheet.getByRole('button', { name: 'Wi-Fi', exact: true })
  await expect(wifi).toHaveAttribute('aria-pressed', 'true')

  // Named exactly, since the output menu of the same sheet is labelled
  // "Output: Optical" and a loose match would hit both.
  const optical = sheet.getByRole('button', { name: 'Optical', exact: true })
  await expect(optical).toHaveAttribute('aria-pressed', 'false')
  await optical.click()
  await expect(optical).toHaveAttribute('aria-pressed', 'true')
  await expect(wifi).toHaveAttribute('aria-pressed', 'false')

  // The demo holds one fleet in memory: put the network input back, or every
  // test after this one would meet a speaker it was not written against.
  await wifi.click()
  await expect(wifi).toHaveAttribute('aria-pressed', 'true')
})

// A speaker alone keeps the sound card under its player: it has no row, so the
// card is the only way to its equalizer. One card on the page is the point: the
// group draws none, since its speakers open their own.
test('keeps the sound card of a speaker that drives no group', async ({ page }) => {
  await openHub(page)

  const sound = page.getByRole('button', { name: 'Sound, show' })
  await expect(sound).toHaveCount(1)
  await expect(sound).toHaveAttribute('aria-controls', 'sound-panel-192.0.2.22')
  await sound.click()
  await expect(page.getByRole('button', { name: 'Sound, hide' })).toBeVisible()

  const panel = page.locator('[id="sound-panel-192.0.2.22"]')
  await expect(panel.getByRole('button', { name: /^-?\d+ (Hz|kHz) [+-]?\d+\.\d dB$/ })).toHaveCount(
    10
  )
  await expect(panel.getByRole('button', { name: 'Flat' })).toBeVisible()
  await expect(panel.getByText('This player reports room correction.')).toHaveCount(0)
  await expect(page.getByText('48 kHz · 24 bit · 1536 kb/s')).toBeVisible()
})

test('keeps the name being typed across a poll, then renames the speaker', async ({ page }) => {
  await openHub(page)

  // The sheet reads the speaker when it opens, and only then. A read driven by
  // the poll would rewrite the field every three seconds, which is less than the
  // time it takes to type a name, so the save button could never be reached.
  // The master's settings live on its own row, in the sheet, like every other
  // speaker's: the group card's header only carries the group.
  const card = page.getByRole('button', { name: 'Settings for Living Room' })
  await card.click()
  const sheet = page.getByRole('dialog')
  const name = sheet.getByRole('textbox', { name: 'Name' })
  await expect(name).toHaveValue('Living Room')

  await name.fill('Kitchen')
  await page.waitForTimeout(4000)
  await expect(name).toHaveValue('Kitchen')

  // Written on the speaker, read back from it, and the card follows the poll.
  // The sheet is modal, so the card stays out of the accessibility tree until
  // it closes: the heading is only readable from there.
  await sheet.getByRole('button', { name: 'Rename' }).click()
  await expect(name).toHaveValue('Kitchen')
  await page.keyboard.press('Escape')
  // The card heads on the group's name, so the rename shows on the line that
  // names the speaker driving it.
  await expect(page.getByText('Kitchen · WiiM Pro')).toBeVisible()

  // The demo holds one fleet in memory: put the name back, or every test after
  // this one would meet a speaker it was not written against.
  await page.getByRole('button', { name: 'Settings for Kitchen' }).click()
  const reopened = page.getByRole('textbox', { name: 'Name' })
  await expect(reopened).toHaveValue('Kitchen')
  await reopened.fill('Living Room')
  await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click()
  await expect(reopened).toHaveValue('Living Room')
  await page.keyboard.press('Escape')
  await expect(page.getByText('Living Room · WiiM Pro')).toBeVisible()
})

test('moves a card against its neighbour, and remembers the order', async ({ page }) => {
  await openHub(page)

  const cards = page.locator('[data-testid^="playing-"]')
  await expect(cards).toHaveCount(2)
  // The hub names the reachable speaker first; the page has no preference yet.
  await expect(cards.nth(0)).toHaveAttribute('data-testid', 'playing-192.0.2.21')
  await expect(cards.nth(0).getByRole('button', { name: 'Move earlier' })).toBeDisabled()

  await cards.nth(0).getByRole('button', { name: 'Move later' }).click()
  await expect(cards.nth(0)).toHaveAttribute('data-testid', 'playing-192.0.2.22')
  await expect(cards.nth(0).getByRole('heading', { level: 2, name: 'Bedroom' })).toBeVisible()
  await expect(cards.nth(1).getByRole('button', { name: 'Move later' })).toBeDisabled()

  // The order belongs to the reader: the page reloads, the hub keeps answering
  // in its own order, and the cards stay where they were put.
  await page.reload()
  await expect(cards.nth(0)).toHaveAttribute('data-testid', 'playing-192.0.2.22')
})

test('folds a diagnostic card, and keeps it folded across a poll and a reload', async ({
  page,
}) => {
  await openHub(page)

  await page.getByRole('button', { name: 'Diagnostic' }).click()
  const card = page.getByTestId('device-192.0.2.21')
  const other = page.getByTestId('device-192.0.2.22')
  await expect(card.getByRole('heading', { name: 'Fields' })).toBeVisible()

  await card.getByRole('button', { name: 'Collapse' }).click()
  await expect(card.getByRole('button', { name: 'Expand' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  // The header stays readable, the body is one click away.
  await expect(card.getByRole('heading', { level: 2, name: 'Living Room' })).toBeVisible()
  await expect(card.getByRole('heading', { name: 'Fields' })).toBeHidden()
  // The other card keeps its own choice.
  await expect(other.getByRole('heading', { name: 'Fields' })).toBeVisible()

  // A poll rebuilds every card, and must not unfold the one the reader folded.
  await page.waitForTimeout(4000)
  await expect(card.getByRole('heading', { name: 'Fields' })).toBeHidden()

  await page.reload()
  await expect(card.getByRole('heading', { name: 'Fields' })).toBeHidden()
  await card.getByRole('button', { name: 'Expand' }).click()
  await expect(card.getByRole('heading', { name: 'Fields' })).toBeVisible()
})

test('exports the sample history from the diagnostic view', async ({ page }) => {
  await openHub(page)

  await page.getByRole('button', { name: 'Diagnostic' }).click()

  await expect(page.getByRole('heading', { name: 'Living Room' })).toBeVisible()
  await expect(page.getByText('192.0.2.21')).toBeVisible()
  await expect(page.getByText('Demo Wi-Fi').first()).toBeVisible()
  await expect(page.getByText('reachable', { exact: true }).first()).toBeVisible()
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
  const clean = page.getByTestId('device-192.0.2.21')
  await expect(clean.getByTestId('findings-empty')).toHaveText('No anomaly detected')
  await expect(page.getByText(/RSSI -5\d dBm · SNR 35 dB · 0 Wi-Fi drop/).first()).toBeVisible()

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
    guides.getByText('The player does not answer: 3 consecutive poll failures.')
  ).toBeVisible()
  await expect(
    guides.getByText('The flow stops at the first anomaly: that row is the last one.')
  ).toBeVisible()
  await expect(guides.getByText('No anomaly on this flow')).toHaveCount(0)
})

test('states the streaming tier each service reaches, and which one is playing', async ({
  page,
}) => {
  await openHub(page)
  await page.getByRole('button', { name: 'Diagnostic' }).click()

  const panel = page.getByTestId('device-192.0.2.21').getByTestId('services-panel')
  await expect(panel.getByRole('heading', { name: 'Streaming' })).toBeVisible()
  await expect(panel.getByText('29 services')).toBeVisible()

  // The service in use comes first, marked as such, with the top of the ladder
  // the firmware published for it.
  const tidal = panel.locator('dl > div').filter({ hasText: 'Tidal' })
  await expect(panel.locator('dl > div').first()).toContainText('Tidal')
  await expect(tidal.getByText('in use')).toBeVisible()
  await expect(tidal.getByText('HI_RES')).toBeVisible()
  // The whole ladder is kept, and ReplayGain with it, as the device said so.
  await expect(tidal).toHaveAttribute('title', 'LOW < HIGH < LOSSLESS < HI_RES · ReplayGain')

  // A family that publishes a vendor enum is translated, not printed raw.
  const qobuz = panel.locator('dl > div').filter({ hasText: 'Qobuz' })
  await expect(qobuz.getByText('FLAC 24 ≤ 192 kHz')).toBeVisible()

  // The families that publish nothing are folded behind a count, and one click
  // opens them: they are part of the table, they just say nothing about a tier.
  await panel.getByRole('button', { name: 'Show the other 22' }).click()
  const tuneIn = panel.locator('dl > div').filter({ hasText: 'newTuneIn' })
  await expect(tuneIn.getByText('—')).toBeVisible()

  // A silent player is not probed: the panel says why it has nothing to show.
  const offline = page.getByTestId('device-192.0.2.22').getByTestId('services-panel')
  await expect(
    offline.getByText('The player is offline: its table is read when it answers.')
  ).toBeVisible()
})

test('keeps a volume written from the page across a poll', async ({ page }) => {
  await openHub(page)

  const card = page.getByTestId('playing-192.0.2.21')
  const level = card.getByRole('button', { name: 'Volume', exact: true })
  await expect(level).toContainText('44')
  await level.click()
  const sheet = page.getByRole('dialog')
  const volume = sheet.getByRole('slider', { name: 'Apartment' })
  await volume.press('ArrowRight')
  await expect(volume).toHaveValue('45')
  await page.keyboard.press('Escape')
  await expect(level).toContainText('45')

  // One poll is three seconds: the value must survive it, which is what proves
  // the write reached the state instead of only the optimistic override.
  await page.waitForTimeout(4000)
  await expect(level).toContainText('45')

  const response = await page.request.get('/api/state')
  expect(response.ok()).toBe(true)
  const state: { devices: { name: string; volume: number | null }[] } = await response.json()
  expect(state.devices.find(device => device.name === 'Living Room')?.volume).toBe(45)
})

// A member of a group has no card, so its volume is written from the row the
// group card carries. The write goes to that speaker, not to the master: each
// speaker renders the stream at its own level, and mixing the two up would move
// the wrong room.
test('writes the volume of a group member from its row', async ({ page }) => {
  await openHub(page)

  const card = page.getByTestId('playing-192.0.2.21')
  const row = card.getByRole('button', { name: 'Volume of Hallway' })
  await expect(row).toContainText('35')
  await row.click()
  const sheet = page.getByRole('dialog')
  const volume = sheet.getByRole('slider', { name: 'Hallway' })
  await volume.press('ArrowRight')
  await expect(volume).toHaveValue('36')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(4000)
  await expect(row).toContainText('36')

  const response = await page.request.get('/api/state')
  const state: { devices: { name: string; volume: number | null }[] } = await response.json()
  expect(state.devices.find(device => device.name === 'Hallway')?.volume).toBe(36)
  // The master kept its own level.
  expect(state.devices.find(device => device.name === 'Living Room')?.volume).not.toBe(36)
})

// The speaker that drives the group has a level of its own, and it is a device
// write like any other: measured, `setPlayerCmd:vol` on the master does not
// reach the members. That is what lets a reader settle one room while the group
// runs, which the vendor app offers and the group level alone could not.
test('writes the volume of the group master without moving the group', async ({ page }) => {
  await openHub(page)

  const card = page.getByTestId('playing-192.0.2.21')
  const row = card.getByRole('button', { name: 'Volume of Living Room' })
  await expect(row).toContainText('44')
  await row.click()
  const sheet = page.getByRole('dialog')
  const volume = sheet.getByRole('slider', { name: 'Living Room' })
  await volume.press('ArrowRight')
  await expect(volume).toHaveValue('45')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(4000)
  await expect(row).toContainText('45')

  const response = await page.request.get('/api/state')
  const state: { devices: { name: string; volume: number | null }[] } = await response.json()
  expect(state.devices.find(device => device.name === 'Living Room')?.volume).toBe(45)
  // The group did not move with it.
  expect(state.devices.find(device => device.name === 'Hallway')?.volume).toBe(35)
})

// A muted speaker is out of the group gesture: it keeps the level the reader
// left it at, and the group moves on the speakers that can still be heard. The
// vendor app behaves this way, and a write under the mute would make the unmute
// land somewhere the reader never chose.
test('keeps a muted member out of the group volume', async ({ page }) => {
  await openHub(page)

  const card = page.getByTestId('playing-192.0.2.21')
  const member = card.getByRole('button', { name: 'Volume of Hallway' })
  await expect(member).toContainText('35')
  await card.getByRole('button', { name: 'Mute Hallway' }).click()
  // Silence greys the row's level and leaves the mute button as the only way out.
  await expect(member).toBeDisabled()
  const unmute = card.getByRole('button', { name: 'Unmute Hallway' })
  await expect(unmute).toBeEnabled()

  // The group follows the room that can still be heard, and only it is written.
  const level = card.getByRole('button', { name: 'Volume', exact: true })
  await expect(level).toContainText('44')
  await level.click()
  const sheet = page.getByRole('dialog')
  const volume = sheet.getByRole('slider', { name: 'Apartment' })
  await volume.press('ArrowRight')
  await expect(volume).toHaveValue('45')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(4000)
  await expect(level).toContainText('45')

  const response = await page.request.get('/api/state')
  const state: { devices: { name: string; volume: number | null }[] } = await response.json()
  expect(state.devices.find(device => device.name === 'Living Room')?.volume).toBe(45)
  expect(state.devices.find(device => device.name === 'Hallway')?.volume).toBe(35)

  // Unmuted, the room is back at the level it kept, and takes gestures again.
  await unmute.click()
  await expect(member).toBeEnabled()
  await expect(member).toContainText('35')
})

// Dragging in the pop-in writes once, on release, but the readout follows the
// thumb: the value the device reported only lands with the next poll, and a
// number that waits for it answers on release while the thumb has already moved.
test('follows the thumb in the volume readout, before the write is sent', async ({ page }) => {
  await openHub(page)

  const group = page.getByTestId('playing-192.0.2.21')
  const row = group.getByRole('button', { name: 'Volume of Hallway' })
  await expect(row).toContainText('35')
  await row.click()
  const sheet = page.getByRole('dialog')
  const slider = sheet.getByRole('slider', { name: 'Hallway' })
  const readout = sheet.getByTestId('volume-level')
  await expect(readout).toHaveText('35')

  const box = await slider.boundingBox()
  if (box === null) throw new Error('the volume track has no box')
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * 0.35, y)
  await page.mouse.down()
  // Stops short of the loud level: past 85 the sheet asks before writing.
  await page.mouse.move(box.x + box.width * 0.7, y, { steps: 8 })

  // Still held: the number already moved, and nothing was written yet.
  await expect(readout).not.toHaveText('35')
  const held = await page.request.get('/api/state')
  const heldState: { devices: { name: string; volume: number | null }[] } = await held.json()
  expect(heldState.devices.find(device => device.name === 'Hallway')?.volume).toBe(35)

  await page.mouse.up()
  // Released: one write, and the room lands on the level the readout showed.
  const target = Number(await readout.textContent())
  await expect
    .poll(async () => {
      const answer = await page.request.get('/api/state')
      const state: { devices: { name: string; volume: number | null }[] } = await answer.json()
      return state.devices.find(device => device.name === 'Hallway')?.volume
    })
    .toBe(target)
})

// The row is a readout a finger can grab, and the track that moves the room is
// one gesture deeper: wide enough for a thumb, and carrying the two gestures of
// the vendor app, a drag by crank and a tap on either side of the thumb by one.
test('opens a generous volume track, a crank at a time', async ({ page }) => {
  await openHub(page)

  const card = page.getByTestId('playing-192.0.2.21')
  await card.getByRole('button', { name: 'Volume of Hallway' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Hallway' })).toBeVisible()
  const volume = sheet.getByRole('slider', { name: 'Hallway' })
  const readout = sheet.getByTestId('volume-level')
  await expect(readout).toHaveText('35')

  const box = await volume.boundingBox()
  if (box === null) throw new Error('the volume track has no box')
  const y = box.y + box.height / 2

  // 52 % of the scale is 52, and the marks sit at 50 and 55: the thumb lands on
  // 50, and the write follows it.
  await page.mouse.move(box.x + box.width * 0.35, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.52, y, { steps: 6 })
  await page.mouse.up()
  await expect(readout).toHaveText('50')

  // A tap names a side of the thumb, not a distance: right of it one step up,
  // left of it one step down, and on the thumb itself nothing at all.
  await page.mouse.click(box.x + box.width * 0.8, y)
  await expect(readout).toHaveText('51')
  await page.mouse.click(box.x + box.width * 0.2, y)
  await expect(readout).toHaveText('50')
  await page.mouse.click(box.x + box.width * 0.5, y)
  await expect(readout).toHaveText('50')

  // The keyboard keeps both steps: the arrows move one, the page keys a crank.
  await volume.press('ArrowUp')
  await expect(readout).toHaveText('51')
  await volume.press('PageDown')
  await expect(readout).toHaveText('46')

  const response = await page.request.get('/api/state')
  const state: { devices: { name: string; volume: number | null }[] } = await response.json()
  expect(state.devices.find(device => device.name === 'Hallway')?.volume).toBe(46)
})

// Past the loud level a stray crank becomes a physical event on an amp: the
// sheet shows the level the reader asked for and writes nothing until the
// decision is confirmed.
test('asks before taking a room past the loud level', async ({ page }) => {
  await openHub(page)

  const card = page.getByTestId('playing-192.0.2.21')
  await card.getByRole('button', { name: 'Volume of Hallway' }).click()
  const sheet = page.getByRole('dialog')
  const volume = sheet.getByRole('slider', { name: 'Hallway' })
  const readout = sheet.getByTestId('volume-level')

  // Eleven cranks from 35: 85 is written, and 90 waits for the answer.
  const cranks = async (count: number): Promise<void> => {
    for (let step = 0; step < count; step++) await volume.press('PageUp')
  }
  await cranks(10)
  await expect(readout).toHaveText('85')
  await cranks(1)
  await expect(readout).toHaveText('90')
  await expect(sheet.getByText('Set the volume to 90?')).toBeVisible()

  const held = await page.request.get('/api/state')
  const heldState: { devices: { name: string; volume: number | null }[] } = await held.json()
  expect(heldState.devices.find(device => device.name === 'Hallway')?.volume).toBe(85)

  await sheet.getByRole('button', { name: 'Apply' }).click()
  await expect
    .poll(async () => {
      const answer = await page.request.get('/api/state')
      const state: { devices: { name: string; volume: number | null }[] } = await answer.json()
      return state.devices.find(device => device.name === 'Hallway')?.volume
    })
    .toBe(90)
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
  // A sentence is French in its grammar, not only in its words: the count picks
  // the plural branch of the French dictionary.
  await expect(
    page.getByText(/ne répond pas : 3 échecs d'interrogation consécutifs/).first()
  ).toBeVisible()

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
  await expect(dialog.getByText('192.0.2.23')).toBeVisible()

  // The demo fleet is fixed, like a seed from the environment: the list is
  // readable, and it says where the entries come from instead of offering an
  // edit that would not persist.
  await expect(dialog.getByText('from the environment')).toHaveCount(3)
  await expect(dialog.getByRole('button', { name: 'Remove' })).toHaveCount(0)

  // A write is refused with the reason, not silently dropped.
  await dialog.getByLabel('Address to add').fill('192.0.2.99')
  await dialog.getByRole('button', { name: 'Add' }).click()
  await expect(dialog.getByText('The hub refused: the demo does not manage hosts')).toBeVisible()
})

// A phone in a room is 360 CSS pixels wide, and the card has to fit in it. The
// track title never wraps, so a grid whose column has no explicit width sizes
// itself on that title: the card grows past the screen, the page scrolls
// sideways, and the transport row is cut off at the right edge. The title is
// patched into a real answer because the demo's own titles are short enough to
// hide the bug.
test('keeps a long track title inside a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  const long = '(FREE) TIF x Ino Casablanca Type Beat - "Némésis" [Prod. by Nayz]'
  const state: { devices: Record<string, unknown>[] } = await (
    await page.request.get('/api/state')
  ).json()
  const devices = state.devices.map((device, index) =>
    index === 0 ? { ...device, title: long, artist: `${long} (remix)` } : device
  )
  await page.route('**/api/state', route => route.fulfill({ json: { ...state, devices } }))

  await openHub(page)

  // What the reader can scroll past, in CSS pixels: zero means the page and the
  // screen are the same width.
  const sideways = (): Promise<number> =>
    page.evaluate(() => {
      const doc = document.documentElement
      return Math.max(doc.scrollWidth, document.body.scrollWidth) - doc.clientWidth
    })

  await expect(page.getByText(long, { exact: true })).toBeVisible()
  expect(await sideways()).toBe(0)

  // Truncated, not wrapped: the title stays on one line and its hidden tail is
  // the price of the card fitting the screen.
  const tail = await page.getByText(long, { exact: true }).evaluate(el => ({
    hidden: el.scrollWidth - el.clientWidth,
    lines: el.getClientRects().length,
  }))
  expect(tail.hidden).toBeGreaterThan(0)
  expect(tail.lines).toBe(1)

  // The diagnostic view lists the same speakers with longer labels.
  await page.getByRole('button', { name: 'Diagnostic' }).click()
  expect(await sideways()).toBe(0)

  // French labels are the longer ones, and the grid must hold them too.
  await page.evaluate(() => window.localStorage.setItem('wiim-hub:lang', 'fr'))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await page.getByRole('button', { name: 'En lecture' }).click()
  expect(await sideways()).toBe(0)
  await page.getByRole('button', { name: 'Diagnostic' }).click()
  expect(await sideways()).toBe(0)
})

test('lifts a sheet above the on-screen keyboard on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await openHub(page)

  // The watcher publishes what is left of the window before anything opens.
  const published = await page.evaluate(() => ({
    inset: document.documentElement.style.getPropertyValue('--keyboard-inset'),
    height: document.documentElement.style.getPropertyValue('--visible-height'),
  }))
  expect(published.inset).toBe('0px')
  expect(Number.parseFloat(published.height)).toBeGreaterThan(700)

  await page.getByRole('button', { name: 'Devices' }).click()
  const sheet = page.getByRole('dialog')
  const before = await sheet.boundingBox()
  expect(before).not.toBeNull()

  // A browser that only paints the keyboard over the page leaves the layout
  // viewport at full height: the sheet has to move itself up by that gap.
  await page.evaluate(() => {
    const root = document.documentElement
    root.style.setProperty('--keyboard-inset', '300px')
    root.style.setProperty('--visible-height', '460px')
  })

  const after = await sheet.boundingBox()
  expect(Math.round((before?.y ?? 0) - (after?.y ?? 0))).toBeGreaterThan(150)
  // Its bottom edge sits on the keyboard, and it never grows past the screen.
  expect(Math.round((after?.y ?? 0) + (after?.height ?? 0))).toBeLessThanOrEqual(461)
  // The field the keyboard was opened for, and its button, stay reachable.
  await expect(sheet.getByLabel('Address to add')).toBeInViewport()
  await expect(sheet.getByRole('button', { name: 'Add' })).toBeInViewport()
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
  await expect(page.getByRole('heading', { level: 2, name: 'Apartment' })).toBeVisible()
  await expect(page.getByText('Hub unreachable')).toBeVisible()
  await context.setOffline(false)

  // And the API was never part of it: the page kept the last state it received
  // and dates it, instead of showing a cached answer as the live one.
  await expect(page.getByText(/Last state received/)).toBeVisible()
})

// The browser looks for a new worker by comparing the script it already has with
// the one served, byte for byte. `public/sw.js` is the same file at every
// release, so the build stamps the release into it: without that, the check
// would answer "same script" and an open window would keep the bundle it loaded,
// with no banner to say otherwise.
test('serves the worker stamped with the release it was built from', () => {
  const worker = readFileSync(resolve('dist/app/sw.js'), 'utf8')
  const manifest: { version: string } = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  expect(worker).toContain(`wiim-hub-shell-${manifest.version}`)
  expect(worker).not.toContain('__HUB_VERSION__')
})

test('offers a new version to a window that stayed open, instead of a reinstall', async ({
  page,
}) => {
  await openHub(page)

  // The installed app launches on the version it finds: one worker controls the
  // page, and no other waits behind it.
  expect(
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      return {
        controller: navigator.serviceWorker.controller !== null,
        waiting: registration.waiting !== null,
      }
    })
  ).toEqual({ controller: true, waiting: false })

  // A deploy, from the page's side: the worker script changes. It is the one
  // file the browser checks on its own, so touching it is what a release looks
  // like here, without rebuilding the bundle.
  const worker = resolve('dist/app/sw.js')
  await replaceTemporarily(
    worker,
    `${readFileSync(worker, 'utf8')}\n// the next release\n`,
    async () => {
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready
        await registration.update()
        for (let index = 0; index < 50 && registration.waiting === null; index += 1) {
          await new Promise(done => setTimeout(done, 100))
        }
      })

      // The new worker waits instead of taking over: the banner is how the page
      // says so, and the reload is offered rather than forced, because the hand
      // may be in the middle of a rename.
      await expect(page.getByText('A new version of the hub is ready.')).toBeVisible()

      const navigation = page.waitForEvent('framenavigated')
      await page.getByRole('button', { name: 'Reload' }).click()
      await navigation
      await expect(page.getByRole('heading', { level: 2, name: 'Apartment' })).toBeVisible()

      // Reloaded once, on the new worker, and the banner is gone: nothing is left
      // waiting and nothing invites a second click.
      const after = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready
        return {
          waiting: registration.waiting !== null,
          banner: document.body.textContent.includes('A new version of the hub is ready.'),
        }
      })
      expect(after).toEqual({ waiting: false, banner: false })
    }
  )
})

test('serves the manifest of this release, not the cached one', async ({ page }) => {
  await openHub(page)
  // The page has to be controlled, otherwise the assertion would only prove
  // that the server answers.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)

  const manifest = resolve('dist/app/manifest.webmanifest')
  const original = readFileSync(manifest, 'utf8')
  const edited = original.replace(/"description": "[^"]*"/, '"description": "the next release"')
  await replaceTemporarily(manifest, edited, async () => {
    const body = await page.evaluate(() =>
      fetch('/manifest.webmanifest').then(answer => answer.json())
    )
    // Served from the cache, the browser would read the manifest of the release
    // it installed, and a changed name, colour or shortcut would never arrive.
    expect(body.description).toBe('the next release')
    expect(body.id).toBe('/')
  })
})

test('keeps the last state it received, dated, when the hub goes quiet', async ({ page }) => {
  // On the poll alone: a live stream keeps the page fed, so this is the reader
  // that has to survive the silence. The route is intercepted before the load,
  // because routing does not reach a response the page already holds open.
  await page.route('**/api/events', route => route.fulfill({ status: 404, body: 'not found' }))
  await openHub(page)
  await expect(page.getByText('Late Ferry', { exact: true })).toBeVisible()

  await page.route('**/api/state*', route => route.abort())
  await expect(page.getByText('Hub unreachable')).toBeVisible({
    timeout: 20_000,
  })
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
    await expect(page.getByText('2 of 3 online')).toBeHidden()

    const group = await page.getByRole('heading', { name: 'Apartment' }).boundingBox()
    const bedroom = await page.getByRole('heading', { name: 'Bedroom' }).boundingBox()
    expect(group).not.toBeNull()
    expect(bedroom).not.toBeNull()
    expect(bedroom?.y ?? 0).toBeGreaterThan(group?.y ?? 0)
  })
})

// The group gestures, on the demo fleet. The demo applies the same plan the hub
// sends (`server/demo.ts`), so what the page reads back is what a group of real
// speakers reports: a group volume fans out, a group mute is one write, a room's
// own mute silences that room alone, and the two teardown gestures belong to the
// speaker that owns the group.
test.describe('multiroom', () => {
  test('carries every speaker of the group along, in proportion', async ({ page }) => {
    await openHub(page)

    const group = page.getByTestId('playing-192.0.2.21')
    const level = group.getByRole('button', { name: 'Volume', exact: true })
    await expect(level).toContainText('44')
    // Hallway sits at 35 of the group's 44, so one step up takes it to 36: the
    // level it keeps is the ratio the reader set, not the driver's own level.
    const hallway = group.getByRole('button', { name: 'Volume of Hallway' })
    await expect(hallway).toContainText('35')
    await level.click()
    const sheet = page.getByRole('dialog')
    const volume = sheet.getByRole('slider', { name: 'Apartment' })
    await volume.press('ArrowRight')
    await expect(volume).toHaveValue('45')
    // While the sheet is open the page behind it leaves the accessibility tree,
    // so the painted row is read from the DOM it still is.
    await expect(group.locator('[aria-label="Volume of Hallway"]')).toContainText('36')
    await page.keyboard.press('Escape')
    await expect(hallway).toContainText('36')

    const response = await page.request.get('/api/state')
    expect(response.ok()).toBe(true)
    const state: { devices: { name: string; volume: number | null }[] } = await response.json()
    expect(state.devices.find(device => device.name === 'Hallway')?.volume).toBe(36)
  })

  test('keeps a row on the full scale, whatever max_volume the speaker reports', async ({
    page,
  }) => {
    await openHub(page)

    // `max_volume` is a setting the vendor app exposes, not a hardware stop:
    // Hallway reports 30 while sitting at 35, so a track that took it as a bound
    // pinned its thumb to the right of a scale that stopped at 30 and showed the
    // wrong level.
    const hallway = page
      .getByTestId('playing-192.0.2.21')
      .getByRole('button', { name: 'Volume of Hallway' })
    await expect(hallway).toContainText('35')
    await hallway.click()
    const sheet = page.getByRole('dialog')
    const volume = sheet.getByRole('slider', { name: 'Hallway' })
    await expect(volume).toHaveAttribute('max', '100')
    await expect(volume).toHaveValue('35')

    // The write above the setting is what proves the bound is gone: 36 is past
    // the 30 the speaker reports, and the demo answers the same plan the hub
    // builds.
    await volume.press('ArrowRight')
    await expect(volume).toHaveValue('36')
    const response = await page.request.get('/api/state')
    const state: { devices: { name: string; volume: number | null; maxVolume: number | null }[] } =
      await response.json()
    const device = state.devices.find(entry => entry.name === 'Hallway')
    expect(device?.maxVolume).toBe(30)
    expect(device?.volume).toBe(36)
  })

  test('paints the group while the thumb moves, and writes before the release', async ({
    page,
  }) => {
    await openHub(page)

    const group = page.getByTestId('playing-192.0.2.21')
    const trigger = group.getByRole('button', { name: 'Volume', exact: true })
    await trigger.click()
    const sheet = page.getByRole('dialog')
    const volume = sheet.getByRole('slider', { name: 'Apartment' })
    // The page behind the sheet leaves the accessibility tree while it is open,
    // so the painted rows are read from the DOM they still are.
    const hallway = group.locator('[aria-label="Volume of Hallway"]')
    await expect(hallway).toContainText('35')
    const box = await volume.boundingBox()
    if (box === null) throw new Error('the group volume track has no box')

    // A real drag: the thumb goes past the middle of the track and stays there,
    // so nothing is released while the assertions run.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 8 })

    // The rows follow the thumb before the reader lets go: Hallway sits at 35 of
    // the group's 44, so it lands on its share of whatever level the hand
    // reached. The drag lands on a crank, so the level is a multiple of five.
    const level = Number(await volume.inputValue())
    expect(level).toBeGreaterThan(60)
    expect(level % 5).toBe(0)
    const expected = Math.round((level * 35) / 44)
    await expect(hallway).toContainText(String(expected))

    // The writes leave during the drag, not on release: the demo answers the
    // same plan the hub sends, so `/api/state` already carries the new levels.
    await expect
      .poll(async () => {
        const response = await page.request.get('/api/state')
        const state: { devices: { name: string; volume: number | null }[] } = await response.json()
        return state.devices.find(device => device.name === 'Hallway')?.volume
      })
      .toBe(expected)

    await page.mouse.up()
    await expect(volume).toHaveValue(String(level))
    await expect(hallway).toContainText(String(expected))
  })

  test('mutes the whole group, and every row reports it', async ({ page }) => {
    await openHub(page)

    const group = page.getByTestId('playing-192.0.2.21')
    // Every mute button on one card is named: the group's own, and one per row.
    await expect(group.getByRole('button', { name: 'Mute Apartment' })).toBeVisible()
    await expect(group.getByRole('button', { name: 'Mute Hallway' })).toBeVisible()
    await group.getByRole('button', { name: 'Mute Apartment' }).click()
    await expect(group.getByRole('button', { name: 'Unmute Apartment' })).toBeVisible()

    // The group mute is the one gesture that reaches the members, so one write
    // silences them all and every row reports it.
    await expect(group.getByRole('button', { name: 'Unmute Hallway' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(group.getByRole('button', { name: 'Unmute Living Room' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  // The gesture the bug was about: muting the room that drives the group used to
  // silence the whole group, because the master's LinkPlay mute propagates. It
  // now leaves by UPnP, where the speaker is silenced alone (measured 20/11).
  test('mutes the room that drives the group, and only that room', async ({ page }) => {
    await openHub(page)

    const group = page.getByTestId('playing-192.0.2.21')
    await group.getByRole('button', { name: 'Mute Living Room' }).click()

    await expect(group.getByRole('button', { name: 'Unmute Living Room' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(group.getByRole('button', { name: 'Mute Hallway' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    // The group is still heard: the button above the list does not claim it is
    // muted, which is what the master's own state alone would have said.
    await expect(group.getByRole('button', { name: 'Mute Apartment' })).toBeVisible()

    const response = await page.request.get('/api/state')
    const state: { devices: { name: string; mute: boolean }[] } = await response.json()
    expect(state.devices.find(device => device.name === 'Living Room')?.mute).toBe(true)
    expect(state.devices.find(device => device.name === 'Hallway')?.mute).toBe(false)
  })

  test('takes a member out of the group, from the sheet of that member', async ({ page }) => {
    await openHub(page)

    const group = page.getByTestId('playing-192.0.2.21')
    await group.getByRole('button', { name: 'Settings for Hallway' }).click()
    const sheet = page.getByRole('dialog')
    // The gesture asks once: the speaker stops rendering the stream.
    await sheet.getByRole('button', { name: 'Remove from the group' }).click()
    await sheet.getByRole('button', { name: 'Remove from the group' }).click()

    // The kicked speaker is on its own again, and the card of the group stops
    // offering its row and its group volume.
    await expect(page.getByTestId('playing-192.0.2.23')).toBeVisible()
    await expect(group.getByRole('button', { name: 'Volume of Hallway' })).toHaveCount(0)
  })

  test('dissolves the group, then drafts a speaker back into it', async ({ page }) => {
    await openHub(page)

    const group = page.getByTestId('playing-192.0.2.21')
    await group.getByRole('button', { name: /Apartment · 2 speakers$/ }).click()
    const panel = page.locator('[id^="group-panel-"]')
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: 'Dissolve the group' }).click()
    await panel.getByRole('button', { name: 'Dissolve the group' }).click()

    // Nothing drives the group any more: every speaker keeps a card of its own.
    await expect(page.locator('[data-testid^="playing-"]')).toHaveCount(3)
    await expect(page.getByTestId('playing-192.0.2.23')).toBeVisible()

    // A speaker alone can be added to a group it does not drive, and the choice
    // is the master's: the dialog names what the join costs.
    const hallway = page.getByTestId('playing-192.0.2.23')
    await hallway.getByRole('button', { name: 'Join a group' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /Living Room/ }).click()
    await expect(dialog.getByText('Add Hallway to the group driven by Living Room?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Join a group' }).click()

    // One player again: the master's card carries the member as a row.
    await expect(page.locator('[data-testid^="playing-"]')).toHaveCount(2)
    const restored = page.getByTestId('playing-192.0.2.21')
    await expect(restored.getByRole('heading', { level: 2, name: 'Living Room' })).toBeVisible()
    await expect(restored.getByRole('button', { name: 'Volume of Hallway' })).toContainText('35')
  })
})
