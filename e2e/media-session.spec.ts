import { expect, type Page, test } from '@playwright/test'

// The lock screen is not part of the page, so the suite reads it where the
// browser keeps it: `navigator.mediaSession`. The action handlers are captured
// as the page registers them, and calling one is exactly what a lock screen
// does, which is what makes this test a proof rather than a shape check.
// What a lock screen hands a handler: our own shape, so the test calls one the
// way the browser does without dragging the whole DOM interface in.
type Captured = (details?: { action?: string; seekTime?: number; seekOffset?: number }) => void

declare global {
  interface Window {
    __media?: Record<string, Captured>
  }
}

const captureSession = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const session = navigator.mediaSession
    if (session === undefined) return
    const handlers: Record<string, Captured> = {}
    const original = session.setActionHandler.bind(session)
    Object.defineProperty(session, 'setActionHandler', {
      configurable: true,
      value: (action: string, handler: unknown) => {
        if (handler === null) delete handlers[action]
        else handlers[action] = handler as Captured
        original(action as MediaSessionAction, handler as MediaSessionActionHandler | null)
      },
    })
    window.__media = handlers
  })
}

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

const session = {
  title: (page: Page) => page.evaluate(() => navigator.mediaSession.metadata?.title ?? ''),
  playback: (page: Page) => page.evaluate(() => navigator.mediaSession.playbackState),
  handlers: (page: Page) => page.evaluate(() => Object.keys(window.__media ?? {}).sort()),
  call: (page: Page, details: { action: string; seekTime?: number }) =>
    page.evaluate(argument => {
      const handler = window.__media?.[argument.action]
      if (handler === undefined) throw new Error(`no ${argument.action} handler`)
      handler(argument)
    }, details),
}

// The quiet track the page plays so the phone treats the tab as a player: the
// lock screen is built for pages that make a sound, and the hub's music leaves
// by the speakers.
const speaker = (page: Page) =>
  page.evaluate(() => {
    const element = document.querySelector<HTMLAudioElement>('[data-testid="invisible-speaker"]')
    if (element === null) return null
    return {
      paused: element.paused,
      loop: element.loop,
      volume: element.volume,
      src: element.currentSrc,
    }
  })

const fleet = async (
  page: Page
): Promise<{ name: string; status: string; curposMs: number | null }[]> => {
  const response = await page.request.get('/api/state')
  const state: { devices: { name: string; status: string; curposMs: number | null }[] } =
    await response.json()
  return state.devices
}

test('publishes the playing card to the lock screen, and drives the fleet from it', async ({
  page,
}) => {
  await captureSession(page)
  await openHub(page)

  // The track, the artist, and the room the card names: the lock screen shows
  // the group a reader settled, not the speaker that happens to drive it.
  await expect.poll(() => session.title(page)).toBe('Late Ferry')
  const metadata = await page.evaluate(() => ({
    artist: navigator.mediaSession.metadata?.artist ?? '',
    album: navigator.mediaSession.metadata?.album ?? '',
    artwork: navigator.mediaSession.metadata?.artwork?.[0]?.src ?? '',
  }))
  expect(metadata.artist).toBe('The Harbour Lights')
  expect(metadata.album).toBe('Apartment')
  // The cover travels through the hub: an absolute address the lock screen can
  // fetch, because the speaker's own one is plain http on another origin.
  expect(metadata.artwork).toContain('/api/art?host=192.0.2.21')
  expect(metadata.artwork.startsWith('http://')).toBe(true)
  await expect.poll(() => session.playback(page)).toBe('playing')

  // Every gesture the lock screen can offer has a handler, the seeks included.
  expect(await session.handlers(page)).toEqual([
    'nexttrack',
    'pause',
    'play',
    'previoustrack',
    'seekbackward',
    'seekforward',
    'seekto',
    'stop',
  ])

  // Pause from the lock screen: the page flips at once (the write is optimistic)
  // and the hub confirms it on the next answer.
  await session.call(page, { action: 'pause' })
  await expect(
    page.getByTestId('playing-192.0.2.21').getByRole('button', { name: 'Play' })
  ).toBeVisible()
  await expect.poll(() => session.playback(page)).toBe('paused')
  await expect
    .poll(async () => (await fleet(page)).find(device => device.name === 'Living Room')?.status)
    .toBe('pause')

  // Resume, then seek where a lock screen thumb would land: 120 s of a 254 s
  // track, carried to the speaker as the card's own seek command.
  await session.call(page, { action: 'play' })
  await expect.poll(() => session.playback(page)).toBe('playing')
  await session.call(page, { action: 'seekto', seekTime: 120 })
  await expect
    .poll(async () => (await fleet(page)).find(device => device.name === 'Living Room')?.curposMs)
    .toBeGreaterThan(119_000)
})

test('keeps the page a player, so Android has a player to put on the lock screen', async ({
  page,
}) => {
  await captureSession(page)
  await openHub(page)

  // A looping track at a volume nobody hears, served as a blob: nothing to
  // cache, nothing to fetch, and no audio file to ship.
  await expect.poll(async () => (await speaker(page))?.loop).toBe(true)
  const track = await speaker(page)
  expect(track?.src.startsWith('blob:')).toBe(true)
  expect(track?.volume).toBeCloseTo(0.4, 3)

  // A browser that has not seen a gesture refuses to start a sound, so the page
  // arms the first one instead of asking for it: the reader touches nothing.
  await page.mouse.click(5, 5)
  await expect.poll(async () => (await speaker(page))?.paused).toBe(false)

  // The track follows the card: a pause from the lock screen silences the page
  // as it silences the speaker, which is what the phone reads.
  await session.call(page, { action: 'pause' })
  await expect.poll(async () => (await speaker(page))?.paused).toBe(true)
  await session.call(page, { action: 'play' })
  await expect.poll(async () => (await speaker(page))?.paused).toBe(false)
})

test('clears the lock screen when the fleet stops carrying a track', async ({ page }) => {
  await captureSession(page)
  // The poll answers for this test: the stream would keep publishing the fleet
  // the page is told to forget.
  await page.route('**/api/events', route => route.abort())
  await openHub(page)
  await expect.poll(() => session.title(page)).toBe('Late Ferry')

  await page.route('**/api/state*', route =>
    route.fulfill({ json: { ok: true, pollMs: 3000, devices: [] } })
  )

  // Nothing playing, nothing on the lock screen: the page clears the player it
  // owned instead of leaving the track of a speaker that went quiet.
  await expect.poll(() => session.title(page)).toBe('')
  await expect.poll(() => session.playback(page)).toBe('none')
  await expect.poll(() => session.handlers(page)).toEqual([])
  // And the page stops making a sound of its own, rather than leaving the phone
  // with a player that plays nothing.
  await expect.poll(async () => (await speaker(page))?.paused).toBe(true)
})
