import type { ResellerAccentColor } from '@hcs/contracts'

const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const

const hex: Record<ResellerAccentColor, string[]> = {
  gold: ['#FBF6E4', '#F5E9BE', '#EBD68A', '#E2C15F', '#D9B24A', '#D4AF37', '#B8912A', '#8F6F1C', '#6B5214', '#47360D'],
  emerald: [
    '#ECFDF5',
    '#D1FAE5',
    '#A7F3D0',
    '#6EE7B7',
    '#34D399',
    '#10B981',
    '#059669',
    '#047857',
    '#065F46',
    '#064E3B',
  ],
  sky: ['#F0F9FF', '#E0F2FE', '#BAE6FD', '#7DD3FC', '#38BDF8', '#0EA5E9', '#0284C7', '#0369A1', '#075985', '#0C4A6E'],
  rose: ['#FFF1F2', '#FFE4E6', '#FECDD3', '#FDA4AF', '#FB7185', '#F43F5E', '#E11D48', '#BE123C', '#9F1239', '#881337'],
  violet: [
    '#F5F3FF',
    '#EDE9FE',
    '#DDD6FE',
    '#C4B5FD',
    '#A78BFA',
    '#8B5CF6',
    '#7C3AED',
    '#6D28D9',
    '#5B21B6',
    '#4C1D95',
  ],
  orange: [
    '#FFF7ED',
    '#FFEDD5',
    '#FED7AA',
    '#FDBA74',
    '#FB923C',
    '#F97316',
    '#EA580C',
    '#C2410C',
    '#9A3412',
    '#7C2D12',
  ],
}

/** "#D4AF37" -> "212 175 55", the form the Tailwind accent variables use. */
export function rgbTriplet(color: string): string {
  const value = Number.parseInt(color.slice(1), 16)
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`
}

/** CSS variables for one accent; the portal's gold-* classes read them. */
export function accentVariables(accent: ResellerAccentColor): Record<string, string> {
  return Object.fromEntries(shades.map((shade, index) => [`--accent-${shade}`, rgbTriplet(hex[accent][index]!)]))
}

/** Applies the business's accent to the whole page (and its theme color for the phone's status bar). */
export function applyAccent(accent: ResellerAccentColor | undefined): void {
  if (typeof document === 'undefined') return
  const variables = accentVariables(accent ?? 'gold')
  for (const [name, value] of Object.entries(variables)) document.documentElement.style.setProperty(name, value)
}
