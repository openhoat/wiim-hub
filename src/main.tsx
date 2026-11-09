import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import { App } from '@/App'

const root = document.getElementById('root')
if (root === null) throw new Error('missing #root element')

// The shell is cached by a service worker, so the page opens from the tab even
// when the hub is unreachable. Registered after load, so caching never delays
// the first paint, and only in a built bundle: the development server serves the
// sources it edits, which a cache would turn into a stale page.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
