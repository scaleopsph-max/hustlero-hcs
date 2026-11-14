import type { ResellerTier } from '@hcs/contracts'
import { describe, expect, it } from 'vitest'

import { nextTierProgress, referralLink } from './tiers'

const card: ResellerTier = {
  tier: 'gold',
  tierChangedAt: null,
  activeReferrals: 7,
  totalReferrals: 9,
  lifetimeSalesMinor: 32_000_000,
  activeDays: 90,
  tiers: [
    { tier: 'silver', minReferrals: 0, minSalesMinor: 0, spendPerPointMinor: 10_000, credit: false },
    { tier: 'gold', minReferrals: 5, minSalesMinor: 20_000_000, spendPerPointMinor: 8_000, credit: false },
    { tier: 'platinum', minReferrals: 15, minSalesMinor: 50_000_000, spendPerPointMinor: 5_000, credit: true },
  ],
  referralCode: 'MARIA123',
  tenantSlug: 'kape-ni-juan',
  referrals: [],
  credit: { limitMinor: null, paymentTerm: 'prepaid', availableMinor: null, blockedReason: 'not_platinum' },
}

describe('tier progress', () => {
  it('shows both paths to the next tier', () => {
    expect(nextTierProgress(card)).toEqual({
      next: 'platinum',
      referrals: { have: 7, need: 15, percent: 46 },
      sales: { haveMinor: 32_000_000, needMinor: 50_000_000, percent: 64 },
    })
  })

  it('has nothing further at Platinum', () => {
    expect(nextTierProgress({ ...card, tier: 'platinum' })).toBeNull()
  })

  it('builds the referral link for the business', () => {
    expect(referralLink('https://portal.example/', card)).toBe(
      'https://portal.example/apply?b=kape-ni-juan&ref=MARIA123',
    )
  })
})
