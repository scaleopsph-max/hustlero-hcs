import type { PosSalesContext, PosSaleCompleteRequest } from '@hcs/contracts'
import { quoteRetailTicketDiscount } from '@hcs/domain'
import type { ResolvedPosPricing } from './pos-pricing'
export function resolvePosDiscount(
  pricing: ResolvedPosPricing,
  lines: PosSaleCompleteRequest['lines'],
  selection: PosSaleCompleteRequest['discount'],
  context: Pick<PosSalesContext, 'canApplyDiscount' | 'discounts'>,
) {
  if (!selection)
    return { eligible: pricing.eligible, error: pricing.error, discountMinor: 0, totalMinor: pricing.totalCentavos }
  try {
    if (!pricing.eligible) throw new Error(pricing.error ?? 'Cart pricing is unavailable.')
    if (!context.canApplyDiscount) throw new Error('Your cashier role cannot apply discounts.')
    if (pricing.priceListId !== null) throw new Error('Discounts require an entirely retail-priced ticket.')
    const definition = context.discounts?.find(
      (row) => row.id === selection.discountId && row.revision === selection.expectedRevision,
    )
    if (!definition || definition.status !== 'active')
      throw new Error('Selected discount changed. Refresh checkout before selecting it again.')
    const quote = quoteRetailTicketDiscount(
      { ...definition, ...definition.value },
      {
        channel: 'pos',
        existingDiscountMinor: 0,
        loyaltyRedemptionMinor: 0,
        lines: lines.map((line) => ({
          id: line.variantId,
          grossMinor: pricing.lines.get(line.variantId)?.lineTotalCentavos ?? -1,
          taxMinor: 0,
          pricingType: 'retail',
        })),
      },
    )
    return { eligible: true, error: null, discountMinor: quote.discountMinor, totalMinor: quote.totalMinor }
  } catch (cause) {
    return {
      eligible: false,
      error: cause instanceof Error ? cause.message : 'Discount unavailable.',
      discountMinor: 0,
      totalMinor: 0,
    }
  }
}
