import { expect, it } from 'vitest'
import {
  discountCommandMatches,
  discountDecimal,
  discountDefinitivelyRejected,
  parseDiscountValue,
  reconcileDiscount,
  restoreDiscountCommand,
  type PendingDiscount,
} from './discount-commands'
const id = 'c0000000-0000-4000-8000-000000000001'
const command: PendingDiscount = {
  key: 'b0000000-0000-4000-8000-000000000001',
  payload: { action: 'create', name: 'Retail', value: { kind: 'fixed', amountMinor: 123 }, status: 'inactive' },
}
const result = {
  id,
  name: 'Retail',
  value: { kind: 'fixed', amountMinor: 123 },
  status: 'inactive',
  revision: 1,
  scope: 'retail_ticket',
  updatedAt: '2026-10-27T12:00:00Z',
}
it('restores the exact original command, never generates a replacement key', () => {
  const restored = restoreDiscountCommand(JSON.stringify(command))
  expect(discountCommandMatches(command, restored)).toBe(true)
  expect(discountCommandMatches(command, null)).toBe(false)
  expect(restoreDiscountCommand(null)).toBe(null)
  expect(() => restoreDiscountCommand('{broken')).toThrow()
  expect(() =>
    restoreDiscountCommand(JSON.stringify({ ...command, payload: { ...command.payload, tenantId: id } })),
  ).toThrow()
})
it('accepts immutable proof of the original command even after the current definition changed', () => {
  expect(reconcileDiscount(command, result, structuredClone(result))).toEqual(result)
  expect(() => reconcileDiscount(command, result, { ...result, revision: 2 })).toThrow(/reconciled/)
  expect(() => reconcileDiscount(command, { ...result, revision: 2 }, { ...result, revision: 2 })).toThrow(/reconciled/)
})
it.each([
  { id: 'c0000000-0000-4000-8000-000000000002' },
  { name: 'Other' },
  { value: { kind: 'percent', rateBps: 123 } },
  { status: 'active' },
  { revision: 2 },
  { updatedAt: '2026-10-27T13:00:00Z' },
])('rejects altered exact historical proof: %j', (change) =>
  expect(() => reconcileDiscount(command, result, { ...result, ...change })).toThrow(),
)
it('validates revision increments and archived targets', () => {
  const update: PendingDiscount = {
    ...command,
    payload: {
      ...command.payload,
      action: 'update',
      discountId: id,
      expectedRevision: 4,
    } as PendingDiscount['payload'],
  }
  expect(reconcileDiscount(update, { ...result, revision: 5 }, { ...result, revision: 5 })).toMatchObject({
    revision: 5,
  })
  expect(() => reconcileDiscount(update, result, result)).toThrow()
  const archive: PendingDiscount = { ...command, payload: { action: 'archive', discountId: id, expectedRevision: 5 } }
  expect(
    reconcileDiscount(
      archive,
      { ...result, status: 'archived', revision: 6 },
      { ...result, status: 'archived', revision: 6 },
    ),
  ).toMatchObject({ status: 'archived' })
  expect(() => reconcileDiscount(archive, { ...result, revision: 6 }, { ...result, revision: 6 })).toThrow()
})
it.each([
  'AUTHENTICATION_REQUIRED',
  'DISCOUNT_ACCESS_DENIED',
  'IDEMPOTENCY_KEY_CONFLICT',
  'INVALID_DISCOUNT',
  undefined,
])('retains uncertain or auth outcomes: %s', (code) => expect(discountDefinitivelyRejected(code)).toBe(false))
it.each(['DISCOUNT_DUPLICATE', 'DISCOUNT_ARCHIVED', 'DISCOUNT_REVISION_CONFLICT', 'DISCOUNT_NOT_FOUND'])(
  'permits explicit dismissal only of definitive rejection: %s',
  (code) => expect(discountDefinitivelyRejected(code)).toBe(true),
)
it('parses exact decimal text without floating-point money arithmetic', () => {
  expect(parseDiscountValue('fixed', '999999999.99')).toEqual({ kind: 'fixed', amountMinor: 99999999999 })
  expect(parseDiscountValue('percent', '99.99')).toEqual({ kind: 'percent', rateBps: 9999 })
  expect(parseDiscountValue('fixed', '0.01')).toEqual({ kind: 'fixed', amountMinor: 1 })
  expect(parseDiscountValue('percent', '12.50')).toEqual({ kind: 'percent', rateBps: 1250 })
  expect(discountDecimal(99999999999)).toBe('999999999.99')
})
it.each(['0', '0.00', '-1', '100', '1e2', '0.001', '1,00', '', '01', '1.', 'NaN'])(
  'rejects invalid percentage input %s',
  (input) => expect(() => parseDiscountValue('percent', input)).toThrow(),
)
