import type { Config } from 'tailwindcss'
import hcsPreset from '@hcs/config/hcs-preset'

export default {
  presets: [hcsPreset],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
} satisfies Config
