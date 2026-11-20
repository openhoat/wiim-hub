import { expect, type Page, test } from '@playwright/test'

// The page reads the fleet from the event stream and keeps the poll behind it.
// Both paths are exercised here, against the demo: the stream is what the
// browser gets when the hub serves it, and the poll is what it gets when the
// hub, or whatever sits in front of it, does not.

type Health = { streams?: number }

const openHub = async (page: Page): Promise<void> => {
  await page.request.post('/api/demo/reset')
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.setItem('wiim-hub:lang', 'en')
    window.localStorage.setItem('wiim-hub:theme', 'dark')
  })
  await page.reload()
  await expect(page.locator('[data-testid^="playing-"]').first()).toBeVisible()
}

const streams = async (page: Page): Promise<number> => {
  const response = await page.request.get('/health')
  const health: Health = await response.json()
  return health.streams ?? 0
}

test('reads the fleet from the event stream', async ({ page }) => {
  await openHub(page)

  // The hub counts the responses it is holding open: one page, one stream. A
  // page that had stayed on the poll would leave this at zero.
  await expect.poll(() => streams(page)).toBe(1)

  // The stream carries the same body as the poll, so the card is the same one.
  await expect(page.getByTestId('playing-192.0.2.21')).toBeVisible()
})

test('falls back to the poll when the stream is not served', async ({ page }) => {
  // An ingress that does not pass the route, or a hub too old to have it.
  await page.route('**/api/events', route => route.fulfill({ status: 404, body: 'not found' }))
  await openHub(page)

  // The page asked once, gave up, and did not open a second connection.
  await expect.poll(() => streams(page)).toBe(0)

  // It is alive: a write made outside the page reaches it on the next poll.
  const response = await page.request.post('/api/command?host=192.0.2.21', {
    data: { action: 'volume', level: 21 },
  })
  expect(response.ok()).toBe(true)
  const row = page
    .getByTestId('playing-192.0.2.21')
    .getByRole('button', { name: 'Volume of Living Room' })
  await expect(row).toContainText('21')
})
