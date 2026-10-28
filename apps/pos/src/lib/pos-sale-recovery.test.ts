import { expect, it } from 'vitest'
import {
  createPendingPosSale,
  findPendingPosSale,
  definitivelyRejectedPosSale,
  posSaleStorage,
  reconcilePosSale,
  requireOriginalPosScope,
  restorePendingPosSale,
  samePendingPosSale,
} from './pos-sale-recovery'
const id = (prefix: string) => `${prefix}0000000-0000-4000-8000-000000000001`
const scope = { tenantId: id('1'), deviceId: id('2'), employeeId: id('3'), registerId: id('4'), locationId: id('5') }
const payload = {
  lines: [{ variantId: id('6'), quantityMilli: 1000 }],
  payments: [{ paymentMethodId: id('7'), amountCentavos: 900, tenderedCentavos: 1000 }],
  customerId: null,
  pricingType: 'retail',
  discount: { discountId: id('8'), expectedRevision: 1 },
}
const snapshot = {
  id: id('8'),
  name: 'Retail',
  value: { kind: 'fixed', amountMinor: 100 },
  status: 'active',
  revision: 1,
  scope: 'retail_ticket',
  updatedAt: '2026-10-27T00:00:00Z',
}
const response = {
  saleId: id('9'),
  receiptNumber: 'MAIN-001',
  status: 'completed',
  subtotalCentavos: 1000,
  discountCentavos: 100,
  totalCentavos: 900,
  cashReceivedCentavos: 1000,
  changeCentavos: 100,
  payments: [
    {
      paymentMethodId: id('7'),
      methodName: 'Cash',
      methodType: 'cash',
      amountCentavos: 900,
      tenderedCentavos: 1000,
      changeCentavos: 100,
    },
  ],
  completedAt: '2026-10-27T00:00:00Z',
  customerId: null,
  pricingType: 'retail',
  discountSnapshot: snapshot,
  discountLines: [
    {
      saleLineId: id('a'),
      variantId: id('6'),
      quantityMilli: 1000,
      grossMinor: 1000,
      discountMinor: 100,
      netMinor: 900,
    },
  ],
}
it('persists and restores the exact original key, scope and payload without credentials', () => {
  const command = createPendingPosSale(scope, payload),
    raw = JSON.stringify(command),
    restored = restorePendingPosSale(raw)
  expect(samePendingPosSale(command, restored)).toBe(true)
  expect(samePendingPosSale(command, null)).toBe(false)
  expect(raw).not.toMatch(/sessionToken|password|access_token/)
  expect(restorePendingPosSale(null)).toBeNull()
  expect(posSaleStorage(scope)).not.toBe(posSaleStorage({ ...scope, employeeId: id('b') }))
})
it('prevents a different cashier from starting another checkout over a saved device attempt', () => {
  const command = createPendingPosSale(scope, payload),
    key = posSaleStorage(scope)
  const storage = { length: 1, key: () => key, getItem: () => JSON.stringify(command) }
  expect(findPendingPosSale(storage, scope)).toEqual(command)
  expect(() => findPendingPosSale(storage, { ...scope, employeeId: id('b') })).toThrow(/original cashier/)
  expect(() => findPendingPosSale({ ...storage, key: () => key + 'corrupt' }, scope)).toThrow(/conflicts/)
})
it.each(['{', 'null', '{}', '[]'])('never repairs or silently replaces corrupt recovery %s', (raw) =>
  expect(() => restorePendingPosSale(raw)).toThrow(),
)
it('rejects altered or noncanonical saved payloads', () => {
  const command = createPendingPosSale(scope, payload)
  expect(() =>
    restorePendingPosSale(JSON.stringify({ ...command, payload: { ...command.payload, manualDiscountMinor: 1 } })),
  ).toThrow()
  expect(() => restorePendingPosSale(JSON.stringify({ ...command, key: 'pos_sale_' + '-'.repeat(36) }))).toThrow()
  expect(samePendingPosSale(command, { ...command, key: `pos_sale_${crypto.randomUUID()}` })).toBe(false)
})
it.each(['tenantId', 'deviceId', 'employeeId', 'registerId', 'locationId'] as const)(
  'requires the original %s',
  (field) => {
    const command = createPendingPosSale(scope, payload)
    expect(() => requireOriginalPosScope(command, { ...scope, [field]: id('b') })).toThrow(/original/)
    requireOriginalPosScope(command, scope)
  },
)
it('accepts an exact immutable discounted receipt', () =>
  expect(reconcilePosSale(createPendingPosSale(scope, payload), response)).toMatchObject({
    totalCentavos: 900,
    discountCentavos: 100,
  }))
it.each([
  { totalCentavos: 901 },
  { subtotalCentavos: 1001 },
  { discountCentavos: 99 },
  { cashReceivedCentavos: 999 },
  { changeCentavos: 99 },
  { customerId: id('b') },
  { pricingType: 'wholesale' },
  { discountSnapshot: { ...snapshot, revision: 2 } },
  { discountSnapshot: { ...snapshot, id: id('b') } },
  { discountLines: [{ ...response.discountLines[0], netMinor: 901 }] },
  { discountLines: [{ ...response.discountLines[0], quantityMilli: 2000 }] },
])('retains recovery on mismatched receipt %j', (change) =>
  expect(() => reconcilePosSale(createPendingPosSale(scope, payload), { ...response, ...change })).toThrow(),
)
it('requires bank/wallet last-four evidence on the discounted response', () => {
  const command = createPendingPosSale(scope, {
    ...payload,
    payments: [{ paymentMethodId: id('7'), amountCentavos: 900, tenderedCentavos: 900, referenceLastFour: '0047' }],
  })
  const bank = {
    ...response,
    cashReceivedCentavos: 0,
    changeCentavos: 0,
    payments: [
      {
        paymentMethodId: id('7'),
        methodName: 'Bank',
        methodType: 'bank_transfer',
        amountCentavos: 900,
        tenderedCentavos: 900,
        changeCentavos: 0,
        referenceLastFour: '0047',
      },
    ],
  }
  expect(reconcilePosSale(command, bank)).toMatchObject({ totalCentavos: 900 })
  expect(() =>
    reconcilePosSale(command, { ...bank, payments: [{ ...bank.payments[0], referenceLastFour: '0048' }] }),
  ).toThrow()
})
it('continues to reconcile undiscounted receipts without inventing discount snapshots', () => {
  const command = createPendingPosSale(scope, { ...payload, discount: null })
  expect(
    reconcilePosSale(command, {
      ...response,
      subtotalCentavos: 900,
      discountCentavos: 0,
      discountSnapshot: null,
      discountLines: [],
    }),
  ).toMatchObject({ totalCentavos: 900 })
  expect(() => reconcilePosSale(command, response)).toThrow()
})
it.each([
  'POS_SESSION_INVALID',
  'POS_ACCESS_DENIED',
  'POS_DISCOUNT_ACCESS_DENIED',
  'IDEMPOTENCY_KEY_CONFLICT',
  'INVALID_POS_SALE',
  undefined,
])('never labels an unknown/auth/key outcome as no effect: %s', (code) =>
  expect(definitivelyRejectedPosSale(code)).toBe(false),
)
it.each([
  'POS_DISCOUNT_CHANGED',
  'POS_DISCOUNT_INELIGIBLE',
  'INSUFFICIENT_STOCK',
  'REGISTER_NOT_OPEN',
  'PAYMENT_METHOD_UNAVAILABLE',
])('allows explicit discard only of guarded no-effect rejection: %s', (code) =>
  expect(definitivelyRejectedPosSale(code)).toBe(true),
)
