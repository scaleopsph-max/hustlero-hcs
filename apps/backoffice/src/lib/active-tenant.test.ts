import { describe, expect, it } from 'vitest'

import { formatLocationCount } from './active-tenant'

describe('formatLocationCount', () => {
  it('uses the business location total independently of employee location assignments', () => {
    const ownerAccess = { locationCount: 1, locationIds: [] }

    expect(formatLocationCount(ownerAccess)).toBe('1 location')
  })

  it('pluralizes zero and multiple locations', () => {
    expect(formatLocationCount({ locationCount: 0 })).toBe('0 locations')
    expect(formatLocationCount({ locationCount: 2 })).toBe('2 locations')
  })
})
