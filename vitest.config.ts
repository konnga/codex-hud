import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        statements: 70,
        branches: 58,
        functions: 82,
        lines: 70,
      },
    },
  },
})
