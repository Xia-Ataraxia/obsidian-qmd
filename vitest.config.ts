import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/shared/**', 'src/main.ts'],
    },
    reporters: ['default', 'junit'],
    outputFile: 'test-results.xml',
  },
})
