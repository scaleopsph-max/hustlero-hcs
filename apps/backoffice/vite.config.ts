import { defineConfig } from 'vite'
import vinext from 'vinext'
import { cloudflare } from '@cloudflare/vite-plugin'
import { recoveryBuildEnv } from './recovery-build.mjs'

export default defineConfig({
  define: Object.fromEntries(
    Object.entries(recoveryBuildEnv()).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)]),
  ),
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: 'rsc',
        childEnvironments: ['ssr'],
      },
    }),
  ],
})
