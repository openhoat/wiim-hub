import { defineConfig, devices } from '@playwright/test'

// The suite drives the demo mode, never a speaker: the fleet is fixed, the
// signal history is seeded, so a failure is a bug in the page and not a
// device that went to sleep. The port is not the hub's default one, so a real
// hub left running on 8090 does not answer for the demo.
const port = 8091

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? 'list' : [['github'], ['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `npm run build` produces dist/ first: the demo serves the same bundle as
    // the hub, so the test exercises the interface the image ships.
    command: 'node server/demo.ts',
    url: `http://127.0.0.1:${port}/health`,
    env: { PORT: String(port) },
    reuseExistingServer: process.env.CI === undefined,
    timeout: 30_000,
  },
})
