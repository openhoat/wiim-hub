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
