import { expect, it } from 'vitest'
import { canPerformInventoryCountAction, previewInventoryCount } from './inventory-count'

const snapshots = [{ variantId: 'shoes', expectedMilli: 10_000, balanceVersion: 4 }]
const balances = [{ variantId: 'shoes', onHandMilli: 10_000, balanceVersion: 4 }]
const staff = {
  tenantActive: true,
  membershipActive: true,
  locationAllowed: true,
  isOwner: false,
  activeEmployee: true,
  activeManagerRole: false,
  explicitCountPermission: true,
}
it('allows explicitly authorized staff to count while reserving creation and posting for Owner/Manager', () => {
  expect(canPerformInventoryCountAction(staff, 'enter')).toBe(true)
  expect(canPerformInventoryCountAction(staff, 'create')).toBe(false)
  expect(canPerformInventoryCountAction(staff, 'post')).toBe(false)
  for (const role of [{ isOwner: true }, { activeManagerRole: true }])
    for (const action of ['create', 'enter', 'post'] as const)
      expect(canPerformInventoryCountAction({ ...staff, explicitCountPermission: false, ...role }, action)).toBe(true)
})
it.each(['tenantActive', 'membershipActive', 'locationAllowed'] as const)(
  'denies %s loss even for an Owner',
  (field) => {
    for (const action of ['create', 'enter', 'post'] as const)
      expect(canPerformInventoryCountAction({ ...staff, isOwner: true, [field]: false }, action)).toBe(false)
  },
)
it('denies counting by staff without explicit count permission', () => {
  expect(canPerformInventoryCountAction({ ...staff, explicitCountPermission: false }, 'enter')).toBe(false)
})
it('denies an inactive employee even with a manager role or count permission', () => {
  expect(canPerformInventoryCountAction({ ...staff, activeEmployee: false }, 'enter')).toBe(false)
  expect(canPerformInventoryCountAction({ ...staff, activeEmployee: false, activeManagerRole: true }, 'post')).toBe(
    false,
  )
})
it('denies unknown actions even for an Owner', () => {
  expect(canPerformInventoryCountAction({ ...staff, isOwner: true }, 'delete' as 'create')).toBe(false)
})
it('calculates exact physical variance in milli-units without mutating inputs', () => {
  const entries = [{ variantId: 'shoes', countedMilli: 8_500 }]
  const before = structuredClone({ snapshots, balances, entries })
  expect(previewInventoryCount(snapshots, entries, balances)).toEqual({
    lines: [{ variantId: 'shoes', expectedMilli: 10_000, countedMilli: 8_500, varianceMilli: -1_500, stale: false }],
    stale: false,
    requiresRevalidation: false,
  })
  expect({ snapshots, balances, entries }).toEqual(before)
})
it('detects movement even when stock returns to the same amount', () => {
  expect(
    previewInventoryCount(
      snapshots,
      [{ variantId: 'shoes', countedMilli: 10_000 }],
      [{ ...balances[0]!, balanceVersion: 6 }],
    ).requiresRevalidation,
  ).toBe(true)
})
it('detects changed on-hand even if an inconsistent version is supplied', () => {
  expect(
    previewInventoryCount(
      snapshots,
      [{ variantId: 'shoes', countedMilli: 10_000 }],
      [{ ...balances[0]!, onHandMilli: 9_000 }],
    ).stale,
  ).toBe(true)
})
it('accepts zero count and computes the complete shortage', () => {
  expect(
    previewInventoryCount(snapshots, [{ variantId: 'shoes', countedMilli: 0 }], balances).lines[0]?.varianceMilli,
  ).toBe(-10_000)
})
it('rejects missing, foreign, and duplicate count or balance records', () => {
  for (const [entries, current] of [
    [[], balances],
    [[{ variantId: 'other', countedMilli: 1 }], balances],
    [
      [
        { variantId: 'shoes', countedMilli: 1 },
        { variantId: 'shoes', countedMilli: 2 },
      ],
      balances,
    ],
    [[{ variantId: 'shoes', countedMilli: 1 }], []],
  ] as const)
    expect(() => previewInventoryCount(snapshots, entries, current)).toThrow()
})
it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
  'rejects invalid physical quantity %s',
  (countedMilli) => {
    expect(() => previewInventoryCount(snapshots, [{ variantId: 'shoes', countedMilli }], balances)).toThrow()
  },
)
it('rejects invalid versions and an empty original selection', () => {
  expect(() => previewInventoryCount([], [], [])).toThrow()
  expect(() =>
    previewInventoryCount(
      snapshots,
      [{ variantId: 'shoes', countedMilli: 1 }],
      [{ ...balances[0]!, balanceVersion: -1 }],
    ),
  ).toThrow()
})
