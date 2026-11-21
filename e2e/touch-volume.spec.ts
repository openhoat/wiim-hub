import { expect, type Page, test } from '@playwright/test'

// A finger is not a mouse here: Android's own range jumps its thumb to the
// contact point, and it does so even when the pointerdown is cancelled. While
// the native control owned the pointer, a tap wrote the point it landed on and
// the one step the pop-in promises never happened (measured on a phone, 21/11).
// This file runs with touch events to keep that path under test.
test.use({ hasTouch: true })

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

test('steps a touch tap beside the thumb by one, instead of jumping to it', async ({ page }) => {
  await openHub(page)

  const card = page.getByTestId('playing-192.0.2.21')
  await card.getByRole('button', { name: 'Volume of Hallway' }).click()
  const sheet = page.getByRole('dialog')
  const volume = sheet.getByRole('slider', { name: 'Hallway' })
  const readout = sheet.getByTestId('volume-level')
  await expect(readout).toHaveText('35')

  const box = await volume.boundingBox()
  if (box === null) throw new Error('the volume track has no box')
  const y = box.y + box.height / 2

  // Far right of the thumb: a native range would land on 80, the step is 36.
  await page.touchscreen.tap(box.x + box.width * 0.8, y)
  await expect(readout).toHaveText('36')

  // And the same on the other side, down by one: 35 again, never 20.
  await page.touchscreen.tap(box.x + box.width * 0.2, y)
  await expect(readout).toHaveText('35')

  // Both taps are real writes, not a painted number: the demo fleet holds them.
  await expect
    .poll(async () => {
      const answer = await page.request.get('/api/state')
      const state: { devices: { name: string; volume: number | null }[] } = await answer.json()
      return state.devices.find(device => device.name === 'Hallway')?.volume
    })
    .toBe(35)
})
