import type { Config } from 'tailwindcss'
import hcsPreset from '@hcs/config/hcs-preset'

// Each business picks its portal accent (see src/lib/branding.ts); gold-* classes read CSS variables
// whose defaults in globals.css are the HCS gold.
const accent = (shade: number) => `rgb(var(--accent-${shade}) / <alpha-value>)`

export default {
  presets: [hcsPreset],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((shade) => [shade, accent(shade)]),
        ),
      },
    },
  },
} satisfies Config
