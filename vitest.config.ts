import { defineConfig } from 'vitest/config'

// The unit suite covers the pure layer on both sides of the HTTP boundary: the
// write intents the hub accepts, the commands it builds from them, the
// per-device writer, the device parsers pinned against the answers a real player
// sent (`server/fixtures/`), and the optimistic reconciliation the page paints
// before a poll confirms it. The transport and the components are exercised end
// to end by Playwright, against the demo mode, so they are not in coverage scope.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'server/commands.ts',
        'server/findings.ts',
        'server/guides.ts',
        'server/inventory.ts',
        'server/queue.ts',
        'server/upnp.ts',
        'src/lib/optimistic.ts',
      ],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'dist/coverage',
      thresholds: {
        branches: 80,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
})
