import type { ResellerTier, ResellerTierName } from '@hcs/contracts'

export const tierLabel: Record<ResellerTierName, string> = { silver: 'Silver', gold: 'Gold', platinum: 'Platinum' }

/** Medal colors for each tier (decorative; the tier name is always written out too). */
export const tierStyle: Record<ResellerTierName, { medal: string; ring: string }> = {
  silver: { medal: 'from-slate-100 via-slate-300 to-slate-500', ring: 'ring-slate-300/40' },
  gold: { medal: 'from-amber-100 via-amber-300 to-amber-600', ring: 'ring-amber-300/40' },
  platinum: { medal: 'from-cyan-100 via-indigo-100 to-violet-300', ring: 'ring-indigo-200/50' },
}

export type TierProgress = {
  next: ResellerTierName
  referrals: { have: number; need: number; percent: number }
  sales: { haveMinor: number; needMinor: number; percent: number }
}

const percent = (have: number, need: number) => (need <= 0 ? 100 : Math.min(100, Math.floor((have / need) * 100)))

/** How close the reseller is to the next tier on each path (either one is enough); null at the top tier. */
export function nextTierProgress(card: ResellerTier): TierProgress | null {
  const order: ResellerTierName[] = ['silver', 'gold', 'platinum']
  const next = order[order.indexOf(card.tier) + 1]
  const rule = next ? card.tiers.find((entry) => entry.tier === next) : undefined
  if (!next || !rule) return null
  return {
    next,
    referrals: {
      have: card.activeReferrals,
      need: rule.minReferrals,
      percent: percent(card.activeReferrals, rule.minReferrals),
    },
    sales: {
      haveMinor: card.lifetimeSalesMinor,
      needMinor: rule.minSalesMinor,
      percent: percent(card.lifetimeSalesMinor, rule.minSalesMinor),
    },
  }
}

/** The link a reseller shares so new resellers are counted under them. */
export function referralLink(origin: string, card: Pick<ResellerTier, 'tenantSlug' | 'referralCode'>): string {
  const params = new URLSearchParams({ b: card.tenantSlug, ref: card.referralCode })
  return `${origin.replace(/\/$/, '')}/apply?${params.toString()}`
}

export const creditBlockedText: Record<NonNullable<ResellerTier['credit']['blockedReason']>, string> = {
  not_platinum: 'Credit opens when you reach Platinum.',
  on_hold: 'Your credit is on hold. Orders are pay-first for now. Contact the business for details.',
  overdue: 'You have an overdue invoice. Pay it to order on credit again.',
  unavailable: 'Credit is not available right now. Orders are pay-first.',
}
