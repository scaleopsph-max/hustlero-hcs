import { expect, it } from 'vitest'
import type { RetailDiscount } from '@hcs/contracts'
import { resolvePosDiscount } from './pos-discounts'
import type { ResolvedPosPricing } from './pos-pricing'
const id = 'a0000000-0000-4000-8000-000000000001',
  variant = 'b0000000-0000-4000-8000-000000000001'
const definition: RetailDiscount = {
  id,
  name: 'Retail',
  value: { kind: 'percent', rateBps: 1250 },
  status: 'active',
  revision: 1,
  scope: 'retail_ticket',
  updatedAt: '2026-10-27T00:00:00Z',
}
const pricing: ResolvedPosPricing = {
  eligible: true,
  error: null,
  totalCentavos: 10001,
  priceListId: null,
  priceListName: null,
  lines: new Map([[variant, { unitPriceCentavos: 10001, lineTotalCentavos: 10001, pricingGroupName: null }]]),
}
const cart = [{ variantId: variant, quantityMilli: 1000 }],
  selection = { discountId: id, expectedRevision: 1 }
it('quotes exact half-up discounted payable for the authorized retail ticket', () =>
  expect(resolvePosDiscount(pricing, cart, selection, { canApplyDiscount: true, discounts: [definition] })).toEqual({
    eligible: true,
    error: null,
    discountMinor: 1250,
    totalMinor: 8751,
  }))
it('leaves the existing undiscounted preview unchanged', () =>
  expect(resolvePosDiscount(pricing, cart, null, {})).toEqual({
    eligible: true,
    error: null,
    discountMinor: 0,
    totalMinor: 10001,
  }))
it.each([
  {},
  { canApplyDiscount: false, discounts: [definition] },
  { canApplyDiscount: true, discounts: [] },
  { canApplyDiscount: true, discounts: [{ ...definition, revision: 2 }] },
  { canApplyDiscount: true, discounts: [{ ...definition, status: 'inactive' as const }] },
])('fails closed without current authorized active revision: %j', (context) =>
  expect(resolvePosDiscount(pricing, cart, selection, context).eligible).toBe(false),
)
it('rejects any wholesale/dealer or mixed pricing result', () =>
  expect(
    resolvePosDiscount({ ...pricing, priceListId: id }, cart, selection, {
      canApplyDiscount: true,
      discounts: [definition],
    }).eligible,
  ).toBe(false))
it('rejects fixed discounts leaving zero/negative payable', () => {
  for (const amountMinor of [10001, 10002])
    expect(
      resolvePosDiscount(pricing, cart, selection, {
        canApplyDiscount: true,
        discounts: [{ ...definition, value: { kind: 'fixed', amountMinor } }],
      }).eligible,
    ).toBe(false)
})
it('does not guess amounts for a missing current item', () =>
  expect(
    resolvePosDiscount({ ...pricing, lines: new Map() }, cart, selection, {
      canApplyDiscount: true,
      discounts: [definition],
    }).eligible,
  ).toBe(false))
