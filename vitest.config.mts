import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'], exclude: ['**/*.dom.test.ts'] },
      },
      {
        extends: true,
        resolve: { alias: { '@': fileURLToPath(new URL('./apps/backoffice/src', import.meta.url)) } },
        test: { name: 'backoffice-dom', environment: 'jsdom', include: ['apps/backoffice/**/*.dom.test.ts'] },
      },
      {
        extends: true,
        resolve: { alias: { '@': fileURLToPath(new URL('./apps/pos/src', import.meta.url)) } },
        test: { name: 'pos-dom', environment: 'jsdom', include: ['apps/pos/**/*.dom.test.ts'] },
      },
    ],
  },
})
