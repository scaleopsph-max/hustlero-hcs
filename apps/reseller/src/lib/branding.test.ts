import { describe, expect, it } from 'vitest'

import { accentVariables, rgbTriplet } from './branding'

describe('portal branding', () => {
  it('turns hex colors into the triplets Tailwind reads', () => {
    expect(rgbTriplet('#D4AF37')).toBe('212 175 55')
    expect(rgbTriplet('#10B981')).toBe('16 185 129')
  })

  it('sets all ten accent shades', () => {
    const variables = accentVariables('emerald')
    expect(Object.keys(variables)).toHaveLength(10)
    expect(variables['--accent-500']).toBe('16 185 129')
  })
})
