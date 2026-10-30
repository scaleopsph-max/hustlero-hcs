import { describe, expect, it } from 'vitest'

import { orderBadge, timeLeft } from './labels'

describe('pay-first labels', () => {
  it('shows where an order is in the payment step', () => {
    expect(orderBadge({ status: 'submitted', reviewReason: 'awaiting_payment' }).text).toBe('Awaiting payment')
    expect(orderBadge({ status: 'submitted', reviewReason: 'payment_review' }).text).toBe('Payment sent')
    expect(orderBadge({ status: 'confirmed', reviewReason: null }).text).toBe('Confirmed')
  })

  it('counts down the payment window', () => {
    const now = Date.parse('2026-10-30T08:00:00Z')
    expect(timeLeft('2026-10-30T11:52:00Z', now)).toBe('3h 52m left')
    expect(timeLeft('2026-10-30T08:12:00Z', now)).toBe('12m left')
    expect(timeLeft('2026-10-30T07:59:00Z', now)).toBeNull()
  })
})
