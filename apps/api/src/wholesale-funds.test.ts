import { describe, expect, it, vi } from 'vitest'
import { wholesaleFundAllocationRequestSchema } from '@hcs/contracts'
import { createApp } from './app'
const user = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001',
  payment = '30000000-0000-4000-8000-000000000001'
const payload = {
  paymentId: payment,
  capitalMinor: 6000,
  operatingMinor: 4000,
  settledConfirmed: true,
  settlementReference: 'Cash verified',
  reason: 'Confirmed business fund allocation',
}
const headers = {
  authorization: 'Bearer valid',
  'x-tenant-id': tenant,
  'idempotency-key': 'fund-allocation-001',
  'content-type': 'application/json',
}
function setup(code?: string) {
  const allocate = vi.fn(async () => {
    if (code) throw Object.assign(new Error('Private fund database details'), { code })
    return { paymentId: payment, capitalMinor: 6000, operatingMinor: 4000, recordedAt: '2026-10-11T03:00:00Z' }
  })
  const load = vi.fn(async () => ({ canManage: false, funds: [], payments: [] }))
  const app = createApp({
    verifyAccessToken: async (token) => (token === 'valid' ? { userId: user } : null),
    loadSessionAccess: async () => [
      {
        tenantId: tenant,
        tenantSlug: 'fixture',
        tenantName: 'Fixture',
        isOwner: true,
        employeeId: null,
        locationIds: [],
        locationCount: 0,
        permissions: [],
        entitlements: [],
      },
    ],
    allocateWholesaleFunds: allocate,
    loadWholesaleFunds: load,
  })
  return { app, allocate, load }
}
describe('wholesale fund allocation', () => {
  it('passes authenticated actor and tenant, never payload scope', async () => {
    const { app, allocate } = setup()
    expect(
      (
        await app.request(
          '/v1/wholesale/funds',
          { method: 'POST', headers, body: JSON.stringify(payload) },
          { ENVIRONMENT: 'test' },
        )
      ).status,
    ).toBe(201)
    expect(allocate.mock.calls[0]?.slice(0, 2)).toEqual([user, tenant])
  })
  it('loads fund context using authenticated scope', async () => {
    const { app, load } = setup()
    expect((await app.request('/v1/wholesale/funds', { headers }, { ENVIRONMENT: 'test' })).status).toBe(200)
    expect(load).toHaveBeenCalledWith(user, tenant, { ENVIRONMENT: 'test' })
  })
  it('rejects foreign tenant before database access', async () => {
    const { app, allocate } = setup()
    const response = await app.request(
      '/v1/wholesale/funds',
      { method: 'POST', headers: { ...headers, 'x-tenant-id': payment }, body: JSON.stringify(payload) },
      { ENVIRONMENT: 'test' },
    )
    expect(response.status).toBe(400)
    expect(allocate).not.toHaveBeenCalled()
  })
  it.each([
    ['HCFD1', 403],
    ['HCFD2', 400],
    ['HCFD3', 404],
    ['HCFD4', 409],
    ['HCFD5', 409],
    ['HCAR1', 403],
  ])('sanitizes %s', async (code, status) => {
    const { app } = setup(String(code))
    const response = await app.request(
      '/v1/wholesale/funds',
      { method: 'POST', headers, body: JSON.stringify(payload) },
      { ENVIRONMENT: 'test' },
    )
    expect(response.status).toBe(status)
    expect(await response.text()).not.toContain('Private')
  })
  it.each([
    { settledConfirmed: false },
    { capitalMinor: -1 },
    { operatingMinor: 1.5 },
    { capitalMinor: Number.MAX_SAFE_INTEGER, operatingMinor: 1 },
    { tenantId: tenant },
    { capitalMinor: 0, operatingMinor: 0 },
  ])('rejects unsafe allocation %j', (change) => {
    expect(wholesaleFundAllocationRequestSchema.safeParse({ ...payload, ...change }).success).toBe(false)
  })
  it('supports a zero share without zero ledger postings', () => {
    expect(
      wholesaleFundAllocationRequestSchema.safeParse({ ...payload, capitalMinor: 10000, operatingMinor: 0 }).success,
    ).toBe(true)
  })
})
