// The shell, cached once and served without a network; the API, never cached.
//
// Two kinds of request reach this worker and they want opposite answers. A
// navigation, an asset under `/assets/`, an icon: those change only when the hub
// is redeployed, and a phone in a room with a bad signal deserves to open on the
// interface instead of on the browser's error page. Everything under `/api/` is
// the live truth: a cached copy would show a volume that is no longer set, so
// those requests go straight to the network and their failure stays visible. The
// page then dates the state it renders, which is the whole point.

// The release this worker belongs to, stamped at build time from `package.json`
// (`vite.config.ts`). The browser looks for a new worker by comparing the script
// it already has with the one the server sends, byte for byte: a worker that
// never changes is a deploy nobody is told about, and a window left open keeps
// the old bundle until it is reloaded by hand. The cache carries the same
// release, so the previous shell is dropped on activation.
const CACHE = 'wiim-hub-shell-__HUB_VERSION__'

// Install metadata and icons are read by the browser itself, at launch, to
// decide what the app looks like. Served from the cache they would answer last
// release's manifest to a browser asking about this one, so they are fetched
// first and the cached copy only answers a launch with no network: an icon one
// launch late is a smaller lie than a manifest that never moves.
const METADATA = [
  '/manifest.webmanifest',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
]

// Pre-cached so a first visit that ends offline still opens on something. The
// bundle is not listed here: its name carries a hash the worker cannot know
// before the page loads, so the install reads it from the document instead.
const SHELL = ['/', ...METADATA]

const neverCache = pathname =>
  pathname.startsWith('/api/') || pathname === '/health' || pathname === '/sw.js'

const isMetadata = pathname => METADATA.includes(pathname)

// A response worth keeping: a real 200 of our own origin. An ingress that
// expires the session answers a redirect to its login page, and caching that
// would replace the app with a login form nobody asked for.
const cacheable = response => response.ok && !response.redirected && response.type === 'basic'

// Fetches one URL into the cache and answers the references a stylesheet makes:
// the fonts are named there, not in the document.
const fill = async (cache, url) => {
  try {
    const response = await fetch(url)
    if (!cacheable(response)) return []
    await cache.put(url, response.clone())
    if (!url.endsWith('.css')) return []
    return (await response.text()).match(/\/assets\/[^\s"')]+/g) ?? []
  } catch {
    // offline during install: the next online visit fills the gap
    return []
  }
}

// The document names its bundle, the stylesheet names the fonts: reading both is
// what makes the shell complete before the first network loss, rather than after
// one visit spent controlled by the worker.
const fillShell = async cache => {
  const shell = await cache.match('/')
  if (shell === undefined) return
  const html = await shell.clone().text()
  const queue = new Set(html.match(/\/assets\/[^\s"']+/g) ?? [])
  while (queue.size > 0) {
    const url = queue.values().next().value
    queue.delete(url)
    for (const found of await fill(cache, url)) queue.add(found)
  }
}

// The shell holds one document, whatever URL it was served from, and the assets
// that document references. Anything else is a previous deploy: keeping it would
// grow the cache by one bundle per release.
const referenced = async (cache, html) => {
  const urls = new Set(html.match(/\/assets\/[^\s"']+/g) ?? [])
  for (const stylesheet of [...urls].filter(url => url.endsWith('.css'))) {
    const cached = await cache.match(stylesheet)
    if (cached === undefined) continue
    for (const found of (await cached.text()).match(/\/assets\/[^\s"')]+/g) ?? []) urls.add(found)
  }
  return urls
}

const pruneAssets = async cache => {
  const shell = await cache.match('/')
  if (shell === undefined) return
  const keep = await referenced(cache, await shell.clone().text())
  const requests = await cache.keys()
  await Promise.all(
    requests
      .map(request => new URL(request.url).pathname)
      .filter(pathname => pathname.startsWith('/assets/') && !keep.has(pathname))
      .map(pathname => cache.delete(pathname))
  )
}

const cacheShell = async response => {
  const cache = await caches.open(CACHE)
  await cache.put('/', response)
  await pruneAssets(cache)
}

// The new worker waits instead of taking over at once: the page decides when to
// swap, so a deploy never replaces the bundle under a hand that is using it.
// A first install has no predecessor and activates on its own.
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // One by one: a single unreachable icon must not fail the whole install.
      for (const url of SHELL) await fill(cache, url)
      await fillShell(cache)
    })()
  )
})

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name)))
      await self.clients.claim()
    })()
  )
})

// Network first: a deploy is picked up on the next visit, and the cached shell
// only answers when the network does not. A stale app frame is better than no
// app frame, not better than the current one.
const navigation = request =>
  (async () => {
    try {
      const response = await fetch(request)
      if (cacheable(response)) await cacheShell(response.clone())
      return response
    } catch {
      const cached = await caches.match('/')
      return cached ?? Response.error()
    }
  })()

// Network first, cache behind: what the browser reads about the app itself has
// to be the current answer, and the cached copy only covers a launch with no
// network, where the app opens on the shell it already has.
const metadata = request =>
  (async () => {
    try {
      const response = await fetch(request)
      if (cacheable(response)) {
        const cache = await caches.open(CACHE)
        await cache.put(request, response.clone())
      }
      return response
    } catch {
      const cached = await caches.match(request)
      return cached ?? Response.error()
    }
  })()

// Cache first, refresh behind: the assets are content-hashed, so a hit is never
// out of date, and the refresh keeps the copy for the next offline visit.
const asset = (request, event) =>
  (async () => {
    const cache = await caches.open(CACHE)
    const cached = await cache.match(request)
    const network = fetch(request)
      .then(response => {
        if (cacheable(response)) return cache.put(request, response.clone()).then(() => response)
        return response
      })
      .catch(() => null)
    // The refresh is kept alive on its own: awaiting it would make a cache hit
    // wait for the network, which is the opposite of the point.
    event.waitUntil(network)
    if (cached !== undefined) return cached
    return (await network) ?? Response.error()
  })()

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (neverCache(url.pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(navigation(request))
    return
  }
  if (isMetadata(url.pathname)) {
    event.respondWith(metadata(request))
    return
  }
  event.respondWith(asset(request, event))
})
