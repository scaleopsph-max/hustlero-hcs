import { expect, it } from 'vitest'
import { posDiscountSelectionSchema, posSaleCompleteRequestSchema } from './pos-sales'
const id = 'a0000000-0000-4000-8000-000000000001'
it('accepts an identity/revision selection without taking prices or totals from the client', () => {
  const request = posSaleCompleteRequestSchema.parse({
    lines: [{ variantId: id, quantityMilli: 1000 }],
    payments: [{ paymentMethodId: id, amountCentavos: 900, tenderedCentavos: 1000 }],
    discount: { discountId: id, expectedRevision: 2 },
    totalCentavos: 1,
    unitPriceCentavos: 1,
  })
  expect(request.discount).toEqual({ discountId: id, expectedRevision: 2 })
  expect(request).not.toHaveProperty('totalCentavos')
  expect(request).not.toHaveProperty('unitPriceCentavos')
})
it.each([
  { discountId: id },
  { discountId: id, expectedRevision: 0 },
  { discountId: id, expectedRevision: 1.5 },
  { discountId: id, expectedRevision: 1, amountMinor: 1 },
  { discountId: id, expectedRevision: 1, rateBps: 1 },
  { discountId: 'not-uuid', expectedRevision: 1 },
])('rejects unapproved discount selection %j', (selection) =>
  expect(posDiscountSelectionSchema.safeParse(selection).success).toBe(false),
)
