import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const workerPath = fileURLToPath(new URL('./dist/app/sw.js', import.meta.url))
const token = '__HUB_VERSION__'

const readVersion = (): string => {
  const manifest: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
  )
  if (
    typeof manifest === 'object' &&
    manifest !== null &&
    'version' in manifest &&
    typeof manifest.version === 'string'
  ) {
    return manifest.version
  }
  throw new Error('package.json carries no version')
}

// The browser finds a new service worker by comparing the script it already has
// with the one served, byte for byte. `public/sw.js` is the same file at every
// release, so without a stamp the check runs, answers "same script", and the
// banner never appears: an open window would keep the bundle it loaded. The
// release goes in the cache name here, which is also how the previous shell is
// dropped when the new worker activates.
const stampWorker = (): Plugin => ({
  name: 'stamp-service-worker',
  apply: 'build',
  closeBundle: () => {
    const body = readFileSync(workerPath, 'utf8')
    if (!body.includes(token)) {
      throw new Error(`sw.js carries no ${token}: the release would not reach an open window`)
    }
    writeFileSync(workerPath, body.replace(token, readVersion()))
  },
})

// The API is a separate Node process: the dev server only proxies the two
// paths the browser calls, so the UI keeps working against the real device.
export default defineConfig({
  plugins: [react(), tailwindcss(), stampWorker()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8090',
      '/health': 'http://localhost:8090',
    },
  },
  build: {
    // Every generated artefact lives under dist/, so the tree has one place to
    // look at and one directory to remove. See `npm run clean`.
    outDir: 'dist/app',
  },
})
