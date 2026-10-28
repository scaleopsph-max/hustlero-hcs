import { expect, it } from 'vitest'
import {
  inventoryCountCreateSchema,
  inventoryCountEntrySchema,
  inventoryCountPostSchema,
  inventoryCountSubmitSchema,
} from './inventory-count'
const locationId = '10000000-0000-4000-8000-000000000001'
const variantId = '20000000-0000-4000-8000-000000000001'
it('accepts bounded physical counts without client-supplied inventory snapshots', () => {
  expect(inventoryCountCreateSchema.parse({ locationId, variantIds: [variantId] }).variantIds).toEqual([variantId])
  expect(
    inventoryCountEntrySchema.parse({ expectedRevision: 1, entries: [{ variantId, countedMilli: 0 }] }).entries[0]
      ?.countedMilli,
  ).toBe(0)
})
it('rejects tenant, role, variance and balance values supplied by the client', () => {
  expect(() =>
    inventoryCountCreateSchema.parse({ locationId, variantIds: [variantId], tenantId: locationId, role: 'manager' }),
  ).toThrow()
  expect(() =>
    inventoryCountEntrySchema.parse({
      expectedRevision: 1,
      entries: [{ variantId, countedMilli: 1, varianceMilli: 100, balanceVersion: 1 }],
    }),
  ).toThrow()
})
it('rejects duplicate variants and non-integer or out-of-range quantities', () => {
  expect(() => inventoryCountCreateSchema.parse({ locationId, variantIds: [variantId, variantId] })).toThrow()
  for (const countedMilli of [-1, 0.5, 1_000_000_000_000, NaN])
    expect(() =>
      inventoryCountEntrySchema.parse({ expectedRevision: 1, entries: [{ variantId, countedMilli }] }),
    ).toThrow()
})
it('requires revision and reason for posting', () => {
  expect(() => inventoryCountSubmitSchema.parse({ expectedRevision: 0 })).toThrow()
  expect(() => inventoryCountPostSchema.parse({ expectedRevision: 1, reason: '  ' })).toThrow()
  expect(inventoryCountPostSchema.parse({ expectedRevision: 1, reason: ' Count complete ' }).reason).toBe(
    'Count complete',
  )
})
