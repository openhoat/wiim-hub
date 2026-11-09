import { defineConfig } from 'vitest/config'

// The unit suite covers the pure layer: the write intents the hub accepts, the
// commands it builds from them, and the per-device writer. Everything that
// talks to a speaker is exercised end to end by Playwright, against the demo
// mode, so it is not part of the coverage scope.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['server/commands.ts', 'server/queue.ts'],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        branches: 80,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
})
