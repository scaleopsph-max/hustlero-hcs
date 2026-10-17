import { describe, expect, it } from 'vitest'

import { nextWholesaleOrderNumber } from './wholesale-order-number'

const date = new Date('2026-10-08T12:00:00.000Z')

describe('nextWholesaleOrderNumber', () => {
  it('starts a business day at ordinal one', () => {
    expect(nextWholesaleOrderNumber([], date)).toBe('SO-20261008-001')
  })

  it('advances beyond cancelled or fulfilled order numbers', () => {
    expect(nextWholesaleOrderNumber(['SO-20261008-001', 'SO-20261008-004'], date)).toBe('SO-20261008-005')
  })

  it('ignores orders from other business days and malformed suffixes', () => {
    expect(nextWholesaleOrderNumber(['SO-20261007-009', 'SO-20261008-DRAFT', 'SO-20261008-002'], date)).toBe(
      'SO-20261008-003',
    )
  })
})
