import { expect, it } from 'vitest'
import {
  retailDiscountCommandSchema,
  retailDiscountSchema,
  retailDiscountValueSchema,
  retailDiscountVersionsSchema,
} from './retail-discounts'

const id = '9c39ba91-b85b-4f1e-850a-5f7a2f970d18'
const create = {
  action: 'create',
  name: ' Retail promotion ',
  value: { kind: 'fixed', amountMinor: 100 },
  status: 'inactive',
}

it('accepts predefined fixed and percentage definitions with integer money and basis points', () => {
  expect(retailDiscountCommandSchema.parse(create).action).toBe('create')
  expect(retailDiscountCommandSchema.parse(create)).toMatchObject({ name: 'Retail promotion' })
  expect(retailDiscountValueSchema.parse({ kind: 'percent', rateBps: 9999 })).toEqual({
    kind: 'percent',
    rateBps: 9999,
  })
  expect(retailDiscountValueSchema.parse({ kind: 'fixed', amountMinor: 99_999_999_999 })).toMatchObject({
    amountMinor: 99_999_999_999,
  })
})

it.each([
  { kind: 'fixed', amountMinor: 0 },
  { kind: 'fixed', amountMinor: -1 },
  { kind: 'fixed', amountMinor: 0.1 },
  { kind: 'fixed', amountMinor: 100_000_000_000 },
  { kind: 'fixed', amountMinor: '100' },
  { kind: 'percent', rateBps: 0 },
  { kind: 'percent', rateBps: 10000 },
  { kind: 'percent', rateBps: 10.1 },
  { kind: 'percent', rateBps: 100, amountMinor: 100 },
  { kind: 'fixed', amountMinor: 100, rateBps: 100 },
])('rejects invalid or ambiguous configured values: %j', (value) => {
  expect(retailDiscountValueSchema.safeParse(value).success).toBe(false)
})

it.each([
  { ...create, tenantId: id },
  { ...create, permission: 'discounts.manage' },
  { ...create, status: 'archived' },
  { ...create, name: ' ' },
  { ...create, name: 'x'.repeat(81) },
  { ...create, value: { kind: 'percent', rateBps: 10000 } },
  { action: 'update', discountId: id, name: 'Promotion', value: create.value, status: 'active' },
  { action: 'update', discountId: id, expectedRevision: 0, name: 'Promotion', value: create.value, status: 'active' },
  { action: 'archive', discountId: id, expectedRevision: 1, value: create.value },
  { action: 'archive', discountId: 'invalid', expectedRevision: 1 },
  { action: 'archive', discountId: id, expectedRevision: 2147483648 },
])('rejects caller context, invalid revisions and unsupported command fields: %j', (command) => {
  expect(retailDiscountCommandSchema.safeParse(command).success).toBe(false)
})

it('requires optimistic revisions for edits and archive commands', () => {
  expect(
    retailDiscountCommandSchema.parse({ ...create, action: 'update', discountId: id, expectedRevision: 2 }),
  ).toMatchObject({ expectedRevision: 2 })
  expect(retailDiscountCommandSchema.parse({ action: 'archive', discountId: id, expectedRevision: 3 })).toMatchObject({
    expectedRevision: 3,
  })
})

it('retains archived version snapshots with offset-aware timestamps', () => {
  const snapshot = {
    id,
    name: 'Promotion',
    value: create.value,
    status: 'archived',
    revision: 3,
    scope: 'retail_ticket',
    updatedAt: '2026-10-27T21:00:00+08:00',
  }
  expect(retailDiscountVersionsSchema.parse({ discountId: id, versions: [snapshot] }).versions[0]).toEqual(snapshot)
  expect(retailDiscountSchema.safeParse({ ...snapshot, updatedAt: '2026-10-27T21:00:00' }).success).toBe(false)
  expect(retailDiscountSchema.safeParse({ ...snapshot, scope: 'wholesale' }).success).toBe(false)
  expect(retailDiscountVersionsSchema.safeParse({ discountId: id, versions: [snapshot, snapshot] }).success).toBe(false)
  expect(
    retailDiscountVersionsSchema.safeParse({ discountId: '5f2a7024-1fca-4e73-8b2d-697bf413ff8c', versions: [snapshot] })
      .success,
  ).toBe(false)
})
