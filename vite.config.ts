import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API is a separate Node process: the dev server only proxies the two
// paths the browser calls, so the UI keeps working against the real device.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    outDir: 'dist',
  },
})
