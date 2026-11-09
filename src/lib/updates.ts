// A deployed hub has to reach the app people installed, without asking them to
// reinstall it. The page is served network first, so a launch picks the new
// bundle up on its own; a window left open for days keeps the one it loaded.
// This module closes that gap: it registers the worker, asks for a new version
// when the app comes back to the foreground, and exposes the one waiting so the
// page can offer a reload instead of swapping the bundle under the pointer.
//
// The rules are the ones the browser gives us, not invented ones. Chrome checks
// a manifest at launch (at most once a day) and applies the fields it supports
// after every window is closed; it does not update `icons` on desktop, which no
// site can change from its side. The content, though, is ours to ship: that is
// what this module makes immediate.

const checkIntervalMs = 30 * 60 * 1000

const listeners = new Set<() => void>()
let ready = false
let registration: ServiceWorkerRegistration | null = null
let reloadPending = false
let started = false

const emit = (): void => {
  for (const listener of listeners) listener()
}

const setReady = (value: boolean): void => {
  if (ready === value) return
  ready = value
  emit()
}

export const subscribeUpdates = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const updateReady = (): boolean => ready

// Activate the worker in wait, then reload once it controls the page: the code
// on screen is the old bundle, so letting the new worker claim a window that
// keeps running the old code would be half a deploy. `reloadPending` is how the
// `controllerchange` handler tells our swap from the first install, which claims
// the page too and must not reload it.
export const applyUpdate = (): void => {
  const waiting = registration?.waiting ?? null
  if (waiting === null) return
  reloadPending = true
  setReady(false)
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

export const checkForUpdate = (): void => {
  void registration?.update().catch(() => undefined)
}

const watch = (found: ServiceWorkerRegistration): void => {
  registration = found
  // A worker left in wait by an earlier visit: the page on screen already came
  // from the network, so it is activated without asking. Only a worker that
  // appears while this page lives is worth a banner.
  if (found.waiting !== null && navigator.serviceWorker.controller !== null) {
    found.waiting.postMessage({ type: 'SKIP_WAITING' })
  }
  found.addEventListener('updatefound', () => {
    const installing = found.installing
    if (installing === null) return
    // The worker on a local network reaches `installed` between the event and
    // this listener, so the state is read once now and once on every change:
    // waiting for the next event alone would miss the one that matters.
    const settle = (): void => {
      // `installed` while a page is controlled means a new version waits behind
      // the active one. Without a controller this is the first install, and
      // there is nothing to offer: the app on screen is the one installing.
      if (installing.state === 'installed' && navigator.serviceWorker.controller !== null) {
        setReady(true)
      }
    }
    installing.addEventListener('statechange', settle)
    settle()
  })
}

// Called once, before the first render. A failed registration stays silent: the
// hub works without a worker, it only loses the cached shell.
export const startUpdates = (): void => {
  if (started || !('serviceWorker' in navigator)) return
  started = true
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadPending) location.reload()
  })
  navigator.serviceWorker
    .register('/sw.js')
    .then(watch)
    .catch(() => undefined)

  // An installed app is launched and closed rather than reloaded, so coming
  // back to the foreground is the moment to ask; the interval covers a window
  // that stays open all day. A check is one conditional request on `/sw.js`.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
  window.setInterval(checkForUpdate, checkIntervalMs)
}
