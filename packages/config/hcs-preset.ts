/**
 * HCS design tokens as a Tailwind preset. "Obsidian and gold", with glass surfaces.
 *
 * Put this in packages/config/hcs-preset.ts, then in each app:
 *
 *   // apps/backoffice/tailwind.config.ts  (same for apps/pos and packages/ui)
 *   import hcsPreset from '@hcs/config/hcs-preset'
 *   export default {
 *     presets: [hcsPreset],
 *     content: ['./src/**\/*.{ts,tsx}', '../../packages/ui/src/**\/*.{ts,tsx}'],
 *   }
 *
 * Fonts (Next.js): load with next/font/google and expose CSS variables.
 *
 *   const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display' })
 *   const sans = Figtree({ subsets: ['latin'], variable: '--font-sans' })
 *   <html className={`${display.variable} ${sans.variable}`}>
 *
 * Which surface where:
 *   POS, landing, Super Admin  -> dark. Base bg-ink-950 plus soft gold and gray glows, with glass panels.
 *   Back Office                -> light. Base bg-ink-100 plus glows, glass-light cards, a dark glass sidebar.
 * Glass only works with something behind it, so every screen needs a base color and 2 to 3 glows.
 * The gold-500 button is the single primary action on a screen.
 */
import plugin from 'tailwindcss/plugin'
import type { Config } from 'tailwindcss'

const preset = {
  theme: {
    extend: {
      colors: {
        // Accent. gold-500 carries ink-950 text at 9:1. Use gold-800 for small text on light.
        gold: {
          50: '#FBF6E4',
          100: '#F5E9BE',
          200: '#EBD68A',
          300: '#E2C15F',
          400: '#D9B24A',
          500: '#D4AF37',
          600: '#B8912A',
          700: '#8F6F1C',
          800: '#6B5214',
          900: '#47360D',
        },
        // Black to white. ink-400 is the lightest secondary text on dark, ink-500 on light.
        ink: {
          50: '#F5F5F6',
          100: '#EAEAEC',
          200: '#D6D6DA',
          300: '#B4B4BA',
          400: '#8A8A92',
          500: '#5C5C63',
          600: '#3D3D42',
          700: '#2A2A2E',
          800: '#1B1B1E',
          900: '#0E0E10',
          950: '#08080A',
        },
        // Status, alert severity and system health. Every pair passes 4.5:1 on its surface.
        signal: {
          dark: {
            success: { bg: 'rgba(74,196,128,0.16)', fg: '#7EE0A6' },
            info: { bg: 'rgba(108,168,232,0.16)', fg: '#9CC6F2' },
            attention: { bg: 'rgba(212,175,55,0.18)', fg: '#E9CB6E' },
            warning: { bg: 'rgba(240,160,75,0.16)', fg: '#F5B876' },
            critical: { bg: 'rgba(240,98,91,0.16)', fg: '#FF9A94', solid: '#C93B33' },
          },
          light: {
            success: { bg: '#DDF3E6', fg: '#17603C' },
            info: { bg: '#E2EEFB', fg: '#1D5FA8' },
            attention: { bg: '#F8EDC3', fg: '#6B5214' },
            warning: { bg: '#FDE7CF', fg: '#8F4A08' },
            critical: { bg: '#FDE2DF', fg: '#A8231A', solid: '#C93B33' },
          },
        },
      },

      fontFamily: {
        display: ['var(--font-display)', '"Bricolage Grotesque"', '"Trebuchet MS"', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'Figtree', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },

      fontSize: {
        display: ['64px', { lineHeight: '64px', letterSpacing: '-0.02em', fontWeight: '700' }],
        h1: ['40px', { lineHeight: '44px', letterSpacing: '-0.015em', fontWeight: '700' }],
        h2: ['30px', { lineHeight: '36px', letterSpacing: '-0.01em', fontWeight: '700' }],
        h3: ['22px', { lineHeight: '28px', fontWeight: '700' }],
        h4: ['18px', { lineHeight: '24px', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '28px' }],
        body: ['15px', { lineHeight: '24px' }],
        small: ['13px', { lineHeight: '20px', fontWeight: '500' }],
        caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
        'pos-price': ['28px', { lineHeight: '32px', fontWeight: '700' }],
        'pos-total': ['44px', { lineHeight: '48px', letterSpacing: '-0.01em', fontWeight: '700' }],
      },

      borderRadius: {
        control: '12px', // buttons, inputs, chips with corners
        glass: '20px', // cards and small panels
        panel: '24px', // large panels, tables, drawers
        sheet: '28px', // cart, receipt, landing feature panels
      },

      backdropBlur: {
        glass: '24px',
        'glass-lg': '32px',
      },

      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.10)',
        'glass-lg': '0 16px 48px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.16)',
        'glass-light': '0 0 0 1px rgba(14,14,16,0.05), 0 10px 30px rgba(14,14,16,0.08), inset 0 1px 0 #fff',
      },

      // POS never goes below touch. Back Office controls are 40 to 44.
      minHeight: {
        touch: '44px',
        'touch-lg': '56px',
        'touch-xl': '64px',
      },
      minWidth: {
        touch: '44px',
      },
    },
  },

  plugins: [
    plugin(function (api) {
      api.addComponents({
        // Dark surfaces: POS, landing, Super Admin.
        '.glass': {
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.10)',
          backdropFilter: 'blur(24px) saturate(140%)',
          WebkitBackdropFilter: 'blur(24px) saturate(140%)',
        },
        '.glass-strong': {
          background: 'rgba(255,255,255,0.10)',
          border: '1px solid rgba(255,255,255,0.18)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.16)',
          backdropFilter: 'blur(32px) saturate(150%)',
          WebkitBackdropFilter: 'blur(32px) saturate(150%)',
        },
        '.glass-gold': {
          background: 'rgba(212,175,55,0.14)',
          border: '1px solid rgba(212,175,55,0.45)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.14)',
          backdropFilter: 'blur(24px) saturate(140%)',
          WebkitBackdropFilter: 'blur(24px) saturate(140%)',
        },
        '.glass-solid-dark': {
          background: 'rgba(14,14,16,0.88)',
          border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 16px 48px rgba(14,14,16,0.30), inset 0 1px 0 rgba(255,255,255,0.10)',
          backdropFilter: 'blur(30px) saturate(140%)',
          WebkitBackdropFilter: 'blur(30px) saturate(140%)',
        },
        // Light surfaces: Back Office.
        '.glass-light': {
          background: 'rgba(255,255,255,0.68)',
          border: '1px solid rgba(255,255,255,0.95)',
          boxShadow: '0 0 0 1px rgba(14,14,16,0.05), 0 10px 30px rgba(14,14,16,0.08), inset 0 1px 0 #fff',
          backdropFilter: 'blur(24px) saturate(160%)',
          WebkitBackdropFilter: 'blur(24px) saturate(160%)',
        },
        // Tables and long text. 84% fill so reading never fights the blur.
        '.glass-data': {
          background: 'rgba(255,255,255,0.84)',
          border: '1px solid rgba(255,255,255,0.95)',
          boxShadow: '0 0 0 1px rgba(14,14,16,0.05), 0 10px 30px rgba(14,14,16,0.08), inset 0 1px 0 #fff',
          backdropFilter: 'blur(24px) saturate(160%)',
          WebkitBackdropFilter: 'blur(24px) saturate(160%)',
        },
      })
    }),
  ],
} satisfies Partial<Config>

export default preset
