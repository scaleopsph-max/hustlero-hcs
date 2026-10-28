import { expect, it, vi } from 'vitest'
import { createApp } from './app'
const id = 'a0000000-0000-4000-8000-000000000001',
  discountId = 'b0000000-0000-4000-8000-000000000001'
const payload = {
  lines: [{ variantId: id, quantityMilli: 1000 }],
  payments: [{ paymentMethodId: id, amountCentavos: 900, tenderedCentavos: 1000 }],
  pricingType: 'retail',
  discount: { discountId, expectedRevision: 1 },
}
const headers = {
  'content-type': 'application/json',
  'x-pos-session-token': 'f'.repeat(64),
  'idempotency-key': 'discount-api-pos-key-001',
}
function setup(code?: string) {
  const complete = vi.fn(async (...args: unknown[]) => {
    void args
    if (code) throw Object.assign(new Error('Private SQL details'), { code })
    return {
      saleId: id,
      receiptNumber: 'MAIN-1',
      status: 'completed' as const,
      subtotalCentavos: 1000,
      totalCentavos: 900,
      discountCentavos: 100,
      cashReceivedCentavos: 1000,
      changeCentavos: 100,
      payments: [
        {
          paymentMethodId: id,
          methodName: 'Cash',
          methodType: 'cash' as const,
          amountCentavos: 900,
          tenderedCentavos: 1000,
          changeCentavos: 100,
        },
      ],
      completedAt: '2026-10-27T00:00:00Z',
      loyaltyEarnedPoints: 0,
      loyaltyBalancePoints: null,
      pricingType: 'retail' as const,
      priceListId: null,
      priceListName: null,
    }
  })
  const app = createApp({ completePosSale: complete })
  return {
    complete,
    request: (body: unknown, override: Record<string, string> = headers) =>
      app.request(
        '/v1/pos/sales/complete',
        { method: 'POST', headers: override, body: JSON.stringify(body) },
        { ENVIRONMENT: 'test' },
      ),
  }
}
it('sends only the selection pointer and server-computed request context, ignoring caller totals', async () => {
  const { request, complete } = setup(),
    response = await request({ ...payload, totalCentavos: 1, tenantId: id })
  expect(response.status).toBe(201)
  expect(complete.mock.calls[0]?.[0]).toMatch(/^[a-f0-9]{64}$/)
  expect(complete.mock.calls[0]?.[1]).toEqual(payload)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})
it('does not treat Back Office authentication as a cashier session', async () => {
  const { request, complete } = setup()
  expect(
    (
      await request(payload, {
        'content-type': 'application/json',
        authorization: 'Bearer synthetic-owner',
        'idempotency-key': headers['idempotency-key'],
      })
    ).status,
  ).toBe(401)
  expect(complete).not.toHaveBeenCalled()
})
it.each([
  { discountId },
  { discountId, expectedRevision: 0 },
  { discountId, expectedRevision: 1, amountMinor: 1 },
  { discountId, expectedRevision: 1, rateBps: 500 },
])('rejects unauthorized selection fields before a command: %j', async (discount) => {
  const { request, complete } = setup()
  expect((await request({ ...payload, discount })).status).toBe(400)
  expect(complete).not.toHaveBeenCalled()
})
it.each([
  ['HCDP0', 403, 'POS_DISCOUNT_ACCESS_DENIED'],
  ['HCDP1', 409, 'POS_DISCOUNT_CHANGED'],
  ['HCDP2', 400, 'POS_DISCOUNT_INELIGIBLE'],
  ['HCS93', 403, 'POS_ACCESS_DENIED'],
  ['HCDP4', 400, 'POS_PAYMENT_REFERENCE_REQUIRED'],
])('returns a sanitized discount denial %s', async (code, status, name) => {
  const { request } = setup(String(code)),
    response = await request(payload)
  expect(response.status).toBe(status)
  const value = (await response.json()) as { error: { code: string; message: string } }
  expect(value.error.code).toBe(name)
  expect(value.error.message).not.toContain('Private SQL')
})
