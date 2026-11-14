import { describe, expect, it } from 'vitest'

import { pickBusinessSlug } from './business-link'

describe('pickBusinessSlug', () => {
  it('prefers the business in the link', () => {
    expect(pickBusinessSlug('Pablo', 'lokal-recipe')).toBe('pablo')
  })

  it('falls back to the business this phone opened last', () => {
    expect(pickBusinessSlug(null, 'lokal-recipe')).toBe('lokal-recipe')
    expect(pickBusinessSlug('bad slug!', 'sah')).toBe('sah')
  })

  it('returns nothing when neither is a valid business link', () => {
    expect(pickBusinessSlug('', null)).toBeNull()
    expect(pickBusinessSlug('a'.repeat(64), '--')).toBeNull()
  })
})
