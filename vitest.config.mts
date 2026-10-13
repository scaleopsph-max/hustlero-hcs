import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
  },
})
