import { expect, it } from 'vitest'
import {
  SaleReversalError,
  canDiscardRejectedReversal,
  decodePendingReversal,
  pendingSaleReversalSchema,
  quantityToMilli,
  quoteSaleReversal,
} from './sale-reversal'
import { reversalIds as ids, saleReversalFixture } from './sale-reversal.fixtures'
const scope = { actorId: ids.actor, tenantId: ids.tenant, saleId: ids.sale }
const command = () =>
  pendingSaleReversalSchema.parse({
    version: 1,
    ...scope,
    key: ids.key,
    mode: 'refund',
    expectedAmountMinor: 53,
    body: JSON.stringify({
      reason: 'Original net return',
      lines: [{ saleLineId: ids.line, quantityMilli: 1000, returnToStock: true }],
    }),
  })
it('previews exact original net instead of a gross-unit-price refund', () => {
  expect(
    quoteSaleReversal(saleReversalFixture(), [{ saleLineId: ids.line, quantityMilli: 1000, returnToStock: true }]),
  ).toBe(53)
})
it('rejects mismatched receipt/snapshot headers and stale history', () => {
  const receipt = saleReversalFixture()
  receipt.refundedCentavos = 1
  expect(() =>
    quoteSaleReversal(receipt, [{ saleLineId: ids.line, quantityMilli: 1000, returnToStock: true }]),
  ).toThrow('reconciliation')
})
it('rejects discounted receipts without original snapshots rather than guessing a refund', () => {
  const receipt = saleReversalFixture()
  delete receipt.discountReturnSnapshot
  expect(() =>
    quoteSaleReversal(receipt, [{ saleLineId: ids.line, quantityMilli: 1000, returnToStock: true }]),
  ).toThrow('reconciliation')
})
it.each(['0', '0.001', '1.005', '123.999'])('parses exact decimal milli-quantity %s', (text) => {
  expect(quantityToMilli(text)).toBe(Number(text.replace('.', '')) * (text.includes('.') ? 1 : 1000))
})
it.each(['-1', '1e3', '0.0001', 'NaN', 'Infinity', '1.', ' 1', '1.2.3'])('rejects malformed quantity %s', (text) =>
  expect(() => quantityToMilli(text)).toThrow(),
)
it('stores and restores only the original scoped key/body, without credentials', () => {
  expect(decodePendingReversal(JSON.stringify(command()), scope)).toEqual(command())
  expect(JSON.stringify(command())).not.toContain('token')
})
it.each(['actorId', 'tenantId', 'saleId'] as const)('rejects another %s context', (field) => {
  expect(() => decodePendingReversal(JSON.stringify(command()), { ...scope, [field]: ids.otherLine })).toThrow(
    'another',
  )
})
it('rejects corrupt, extra-field and noncanonical original body data', () => {
  expect(() => decodePendingReversal('{', scope)).toThrow()
  expect(() => decodePendingReversal(JSON.stringify({ ...command(), token: 'unexpected' }), scope)).toThrow()
  expect(() =>
    pendingSaleReversalSchema.parse({ ...command(), body: '{"reason":"Original net return","lines":[],"amount":1}' }),
  ).toThrow()
})
it('permits explicit discard only for known no-effect server denials', () => {
  expect(canDiscardRejectedReversal(new SaleReversalError('Denied', 'SALE_REVERSAL_CONFLICT'))).toBe(true)
  for (const error of [
    new Error('Response lost'),
    new SaleReversalError('Denied', 'SALES_ACCESS_DENIED'),
    new SaleReversalError('Key', 'IDEMPOTENCY_KEY_CONFLICT'),
  ])
    expect(canDiscardRejectedReversal(error)).toBe(false)
})
