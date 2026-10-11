import { describe, it, expect } from 'vitest'
import { wholesaleCreditOverridesContextSchema } from '@hcs/contracts'
const id = '10000000-0000-4000-8000-000000000001',
  timestamp = '2026-10-11T04:00:00Z'
const row = {
  overrideId: id,
  salesOrderId: id,
  orderNumber: 'SYN-001',
  customerId: id,
  action: 'confirm',
  approvedExcessMinor: 100,
  expiresAt: timestamp,
  reason: 'Synthetic approval',
  approvedBy: id,
  approvedAt: timestamp,
  revokedBy: null,
  revokedAt: null,
  revokeReason: null,
  status: 'approved',
  consumption: null,
}
describe('approval history contract', () => {
  it.each(['approved', 'expired', 'revoked', 'consumed'])('accepts server status %s', (status) =>
    expect(
      wholesaleCreditOverridesContextSchema.safeParse({
        asOf: timestamp,
        canApprove: false,
        overrides: [
          {
            ...row,
            status,
            consumption:
              status === 'consumed'
                ? {
                    consumedBy: id,
                    consumedAt: timestamp,
                    excessMinor: 1,
                    exposureMinor: 450000,
                    creditLimitMinor: 449999,
                  }
                : null,
          },
        ],
      }).success,
    ).toBe(true),
  )
  it.each([
    { status: 'pending' },
    { approvedExcessMinor: 1.5 },
    { consumption: { consumedBy: id, consumedAt: timestamp, excessMinor: 0, exposureMinor: 0, creditLimitMinor: 0 } },
  ])('rejects invalid history fields', (change) =>
    expect(
      wholesaleCreditOverridesContextSchema.safeParse({
        asOf: timestamp,
        canApprove: false,
        overrides: [{ ...row, ...change }],
      }).success,
    ).toBe(false),
  )
  it('requires snapshot time rather than trusting browser clock', () =>
    expect(wholesaleCreditOverridesContextSchema.safeParse({ canApprove: false, overrides: [] }).success).toBe(false))
})
