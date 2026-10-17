import { describe, it, expect, vi } from 'vitest'
import { apiErrorResponseSchema } from '@hcs/contracts'
import { createApp } from './app'
const userId = '10000000-0000-4000-8000-000000000001',
  tenantId = '20000000-0000-4000-8000-000000000001',
  id = '30000000-0000-4000-8000-000000000001'
const payload = {
  lines: [{ salesOrderLineId: id, quantityMilli: 1000 }],
  payment: { paymentMethodId: id, amountMinor: 45000, reference: 'Received cash' },
}
const headers = {
  authorization: 'Bearer valid',
  'x-tenant-id': tenantId,
  'content-type': 'application/json',
  'idempotency-key': 'paid-fulfillment-test-001',
}
function setup(code?: string) {
  const fulfill = vi.fn(async () => {
    if (code) throw Object.assign(new Error('Private SQL details'), { code })
    return {
      salesOrderId: id,
      orderStatus: 'fulfilled' as const,
      invoiceId: id,
      invoiceNumber: 'SYN-001',
      saleId: id,
      fulfilledQuantityMilli: 1000,
      totalMinor: 45000,
      issuedAt: '2026-10-11T04:00:00Z',
    }
  })
  const app = createApp({
    verifyAccessToken: async (token) => (token === 'valid' ? { userId } : null),
    loadSessionAccess: async () => [
      {
        tenantId,
        tenantSlug: 'fixture',
        tenantName: 'Fixture',
        isOwner: true,
        employeeId: null,
        locationIds: [],
        locationCount: 1,
        permissions: [],
        entitlements: [],
      },
    ],
    fulfillWholesaleOrder: fulfill,
  })
  return { app, fulfill }
}
describe('paid wholesale fulfillment API', () => {
  it('forwards authenticated tenant and exact payment to the atomic command', async () => {
    const { app, fulfill } = setup()
    const result = await app.request(
      `/v1/wholesale/orders/${id}/fulfill`,
      { method: 'POST', headers, body: JSON.stringify(payload) },
      { ENVIRONMENT: 'test' },
    )
    expect(result.status).toBe(201)
    expect(fulfill).toHaveBeenCalledWith(
      userId,
      tenantId,
      id,
      payload,
      headers['idempotency-key'],
      expect.any(String),
      expect.any(String),
      { ENVIRONMENT: 'test' },
    )
  })
  it.each([
    ['HCSP1', 400],
    ['HCSP2', 409],
    ['HCSP3', 409],
  ] as const)('sanitizes %s', async (code, status) => {
    const { app } = setup(code)
    const result = await app.request(
      `/v1/wholesale/orders/${id}/fulfill`,
      { method: 'POST', headers, body: JSON.stringify(payload) },
      { ENVIRONMENT: 'test' },
    )
    expect(result.status).toBe(status)
    const body = apiErrorResponseSchema.parse(await result.json())
    expect(body.error.code).toBe(`WHOLESALE_PAID_${code}`)
    expect(JSON.stringify(body)).not.toContain('Private SQL')
  })
  it.each([
    { ...payload, tenantId },
    { ...payload, creditOverrideId: id },
    { ...payload, payment: { ...payload.payment, amountMinor: 1.5 } },
  ])('rejects tampered or invalid payment', async (body) => {
    const { app, fulfill } = setup()
    expect(
      (
        await app.request(
          `/v1/wholesale/orders/${id}/fulfill`,
          { method: 'POST', headers, body: JSON.stringify(body) },
          { ENVIRONMENT: 'test' },
        )
      ).status,
    ).toBe(400)
    expect(fulfill).not.toHaveBeenCalled()
  })
})
