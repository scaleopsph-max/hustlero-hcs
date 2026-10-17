import { describe, it, expect } from 'vitest'
import { type WholesaleCreditOverridesContext } from '@hcs/contracts'
import {
  pendingOverrideCommandSchema,
  eligibleOverrideOrders,
  prepareOverrideApproval,
  prepareOverrideRevocation,
  overrideCommandPath,
  overrideCommandDefinitivelyRejected,
  validateOverrideResponse,
} from './wholesale-override-commands'
const id = '30000000-0000-4000-8000-000000000001',
  other = '30000000-0000-4000-8000-000000000002'
const now = Date.parse('2026-10-11T04:00:00Z'),
  expiry = '2026-10-12T04:00:00Z'
const orders = [
  { id, status: 'draft' },
  { id: other, status: 'confirmed' },
]
const context: WholesaleCreditOverridesContext = {
  asOf: '2026-10-11T04:00:00Z',
  canApprove: true,
  overrides: [
    {
      overrideId: id,
      salesOrderId: id,
      orderNumber: 'SYN-001',
      status: 'approved',
      consumption: null,
      customerId: id,
      action: 'confirm',
      approvedExcessMinor: 10001,
      expiresAt: expiry,
      reason: 'Authorized exception',
      approvedBy: id,
      approvedAt: '2026-10-11T04:00:00Z',
      revokedBy: null,
      revokedAt: null,
      revokeReason: null,
    },
  ],
}
const payload = {
  salesOrderId: id,
  action: 'confirm' as const,
  approvedExcessMinor: 10001,
  expiresAt: '2026-10-12T04:00:00.000Z',
  reason: 'Authorized exception',
}
const approve = { kind: 'approve' as const, key: 'synthetic-override-key-001', payload }
const revoke = {
  kind: 'revoke' as const,
  key: 'synthetic-override-key-002',
  overrideId: id,
  payload: { reason: 'Owner revocation' },
}
describe('credit override command UI', () => {
  it('creates exact scoped excess without tenant/customer/actor fields', () =>
    expect(
      prepareOverrideApproval(context, orders, id, 'confirm', '100.01', expiry, 'Authorized exception', now),
    ).toEqual(payload))
  it.each(['0', '-1', '1.001', 'NaN', '90071992547409.92'])('rejects invalid money %s', (amount) =>
    expect(() =>
      prepareOverrideApproval(context, orders, id, 'confirm', amount, expiry, 'Authorized exception', now),
    ).toThrow(),
  )
  it.each(['', 'invalid', '2026-10-11T04:00:00Z', '2026-10-10T04:00:00Z'])('rejects invalid/past expiry %s', (value) =>
    expect(() =>
      prepareOverrideApproval(context, orders, id, 'confirm', '100', value, 'Authorized exception', now),
    ).toThrow(),
  )
  it('requires approval authority', () =>
    expect(() =>
      prepareOverrideApproval({ ...context, canApprove: false }, orders, id, 'confirm', '1', expiry, 'Confirmed', now),
    ).toThrow())
  it('requires listed eligible order', () =>
    expect(() => prepareOverrideApproval(context, orders, other, 'confirm', '1', expiry, 'Confirmed', now)).toThrow())
  it('requires explicit action', () =>
    expect(() => prepareOverrideApproval(context, orders, id, '', '1', expiry, 'Confirmed', now)).toThrow())
  it('limits fulfillment choices to confirmed or partial', () =>
    expect(
      eligibleOverrideOrders(
        [...orders, { id: 'partial', status: 'partially_fulfilled' }, { id: 'cancelled', status: 'cancelled' }],
        'fulfill',
      ).map((row) => row.id),
    ).toEqual([other, 'partial']))
  it('allows authorized revocation', () =>
    expect(prepareOverrideRevocation(context, id, 'Owner revocation')).toEqual(revoke.payload))
  it('does not invent a ban on revoking consumed history', () =>
    expect(
      prepareOverrideRevocation(
        { ...context, overrides: [{ ...context.overrides[0]!, status: 'consumed' }] },
        id,
        'Owner revocation',
      ),
    ).toEqual(revoke.payload))
  it('denies already revoked approvals', () =>
    expect(() =>
      prepareOverrideRevocation(
        { ...context, overrides: [{ ...context.overrides[0]!, revokedAt: expiry }] },
        id,
        'Revoked',
      ),
    ).toThrow())
  it('denies unlisted revocation', () => expect(() => prepareOverrideRevocation(context, other, 'Revoked')).toThrow())
  it('denies unauthorized revocation', () =>
    expect(() => prepareOverrideRevocation({ ...context, canApprove: false }, id, 'Revoked')).toThrow())
  it.each(['', 'a'])('requires reason %s', (reason) =>
    expect(() => prepareOverrideRevocation(context, id, reason)).toThrow(),
  )
  it.each([approve, revoke])('restores exact command identity', (command) =>
    expect(pendingOverrideCommandSchema.parse(JSON.parse(JSON.stringify(command)))).toEqual(command),
  )
  it('rejects corrupt command identity', () =>
    expect(pendingOverrideCommandSchema.safeParse({ ...approve, key: 'short' }).success).toBe(false))
  it('rejects client scope injection', () =>
    expect(pendingOverrideCommandSchema.safeParse({ ...approve, payload: { ...payload, tenantId: id } }).success).toBe(
      false,
    ))
  it('rejects path injection', () =>
    expect(pendingOverrideCommandSchema.safeParse({ ...revoke, overrideId: '../other' }).success).toBe(false))
  it('uses the dedicated command endpoints', () => {
    expect(overrideCommandPath(approve)).toBe('/v1/wholesale/credit-overrides')
    expect(overrideCommandPath(revoke)).toBe(`/v1/wholesale/credit-overrides/${id}/revoke`)
  })
  it.each(['WHOLESALE_OVERRIDE_HCCO2', 'WHOLESALE_OVERRIDE_HCCO4', 'WHOLESALE_OVERRIDE_HCCO5'])(
    'unlocks on definite rejection %s',
    (code) => expect(overrideCommandDefinitivelyRejected(code)).toBe(true),
  )
  it.each([undefined, 'WHOLESALE_OVERRIDE_HCCO1', 'WHOLESALE_OVERRIDE_HCCO3', 'WHOLESALE_OVERRIDE_HCCO6', 'HCS08'])(
    'preserves identity on uncertain failure %s',
    (code) => expect(overrideCommandDefinitivelyRejected(code)).toBe(false),
  )
  it('validates approve response', () =>
    expect(validateOverrideResponse(approve, { overrideId: id, status: 'approved' }).overrideId).toBe(id))
  it('validates exact revoked approval', () =>
    expect(validateOverrideResponse(revoke, { overrideId: id, status: 'revoked' }).overrideId).toBe(id))
  it('rejects wrong response status', () =>
    expect(() => validateOverrideResponse(approve, { overrideId: id, status: 'revoked' })).toThrow())
  it('rejects wrong revoked ID', () =>
    expect(() => validateOverrideResponse(revoke, { overrideId: other, status: 'revoked' })).toThrow())
})
