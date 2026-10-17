import { describe, it, expect } from 'vitest'
import { wholesaleOrderFulfillRequestSchema, type WholesaleOrderContext } from '@hcs/contracts'
import { paidFulfillmentDefinitivelyRejected, preparePaidFulfillment } from './wholesale-paid-fulfillment'
const id = '10000000-0000-4000-8000-000000000001'
const payload = {
  lines: [{ salesOrderLineId: id, quantityMilli: 1000 }],
  payment: { paymentMethodId: id, amountMinor: 45000, reference: 'Received cash' },
}
describe('paid fulfillment contract', () => {
  const order: WholesaleOrderContext['orders'][number] = {
    id,
    orderNumber: 'SYN-001',
    customerId: id,
    customerName: 'Synthetic',
    locationId: id,
    locationName: 'Main',
    priceListId: id,
    pricingType: 'wholesale',
    status: 'confirmed',
    notes: null,
    subtotalMinor: 450000,
    totalMinor: 450000,
    confirmedAt: '2026-10-11T04:00:00Z',
    createdAt: '2026-10-11T04:00:00Z',
    lines: [
      {
        id,
        variantId: id,
        productName: 'Shirt',
        variantName: 'Medium',
        sku: 'SYN',
        orderedQuantityMilli: 10000,
        fulfilledQuantityMilli: 4000,
        cancelledQuantityMilli: 1000,
        unitPriceMinor: 45000,
        lineTotalMinor: 450000,
      },
    ],
  }
  it('parses decimal quantity and money exactly', () =>
    expect(preparePaidFulfillment(order, { [id]: '1.125' }, id, '506.25', 'Cash')).toEqual({
      lines: [{ salesOrderLineId: id, quantityMilli: 1125 }],
      payment: { paymentMethodId: id, amountMinor: 50625, reference: 'Cash' },
    }))
  it.each(['1.0001', '1e3', '-1', '5.001', '9007199254740992'])('rejects invalid or excessive quantity %s', (value) =>
    expect(() => preparePaidFulfillment(order, { [id]: value }, id, '450', 'Cash')).toThrow(),
  )
  it('accepts explicit received payment', () =>
    expect(wholesaleOrderFulfillRequestSchema.safeParse(payload).success).toBe(true))
  it.each([{ amountMinor: 0 }, { amountMinor: 1.5 }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 }, { tenantId: id }])(
    'rejects unsafe payment %j',
    (change) =>
      expect(
        wholesaleOrderFulfillRequestSchema.safeParse({ ...payload, payment: { ...payload.payment, ...change } })
          .success,
      ).toBe(false),
  )
  it('does not mix credit override with full payment', () =>
    expect(wholesaleOrderFulfillRequestSchema.safeParse({ ...payload, creditOverrideId: id }).success).toBe(false))
  it.each(['e_wallet', 'bank_transfer'])('validates %s references without losing leading zeroes', (methodType) => {
    for (const reference of ['', '123', '12345', 'AB12', '\uFF11\uFF12\uFF13\uFF14']) {
      expect(() => preparePaidFulfillment(order, { [id]: '1' }, id, '450', reference, methodType)).toThrow()
    }
    expect(preparePaidFulfillment(order, { [id]: '1' }, id, '450', '0047', methodType).payment?.reference).toBe('0047')
  })
  it.each(['WHOLESALE_PAID_HCSP1', 'WHOLESALE_PAID_HCSP2', 'WHOLESALE_PAID_HCSP3', 'WHOLESALE_PAYMENT_HCAP6'])(
    'unlocks definitive rollback %s',
    (code) => expect(paidFulfillmentDefinitivelyRejected(code)).toBe(true),
  )
  it.each([undefined, 'WHOLESALE_PAYMENT_HCAP1', 'WHOLESALE_COMMAND_HCS08'])(
    'retains ambiguous/authorization outcome %s',
    (code) => expect(paidFulfillmentDefinitivelyRejected(code)).toBe(false),
  )
})
