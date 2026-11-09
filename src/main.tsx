import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { startUpdates } from '@/lib/updates'
import { watchKeyboard } from '@/lib/viewport'
import '@/index.css'
import { App } from '@/App'

const root = document.getElementById('root')
if (root === null) throw new Error('missing #root element')

// The shell is cached by a service worker, so the page opens from the tab even
// when the hub is unreachable. Registered before the first render, so a deploy
// is noticed during the visit instead of after a `load` a slow poll could delay,
// and only in a built bundle: the development server serves the sources it
// edits, which a cache would turn into a stale page.
if (import.meta.env.PROD) startUpdates()

// A sheet pinned to the bottom has to clear the on-screen keyboard: whichever
// way the browser shrinks the page, the inset it leaves is the same rule.
watchKeyboard()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
