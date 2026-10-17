import { expect, it, vi } from 'vitest'
import { createApp } from './app'

const userId = '10000000-0000-4000-8000-000000000001'
const tenantId = '20000000-0000-4000-8000-000000000001'
const saleId = '30000000-0000-4000-8000-000000000001'

it.each([
  ['GET', '', 'HCSA1', 404, 'SALE_NOT_FOUND'],
  ['POST', '/refunds', 'HCSA1', 404, 'SALE_NOT_FOUND'],
  ['POST', '/void', 'HCSA1', 404, 'SALE_NOT_FOUND'],
  ['POST', '/refunds', 'HCSA0', 403, 'SALES_ACCESS_DENIED'],
  ['POST', '/void', 'HCS08', 409, 'IDEMPOTENCY_KEY_CONFLICT'],
] as const)(
  'maps %s receipt%s denial %s without exposing database detail',
  async (method, suffix, code, status, apiCode) => {
    const denied = vi.fn(async () => {
      throw Object.assign(new Error('Private unassigned branch and receipt detail'), { code })
    })
    const app = createApp({
      verifyAccessToken: async () => ({ userId }),
      loadSessionAccess: async () => [
        {
          tenantId,
          tenantSlug: 'synthetic',
          tenantName: 'Synthetic',
          isOwner: false,
          employeeId: null,
          locationIds: [],
          locationCount: 1,
          permissions: [],
          entitlements: [],
        },
      ],
      loadSaleReceipt: denied,
      refundSale: denied,
      voidSale: denied,
    })
    const response = await app.request(
      `/v1/sales/${saleId}${suffix}`,
      {
        method,
        headers: {
          Authorization: 'Bearer synthetic',
          'X-Tenant-Id': tenantId,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'synthetic-scope-denial-key',
        },
        ...(method === 'POST'
          ? {
              body: JSON.stringify({
                reason: 'Synthetic test',
                ...(suffix === '/refunds'
                  ? { lines: [{ saleLineId: saleId, quantityMilli: 1000, returnToStock: true }] }
                  : {}),
              }),
            }
          : {}),
      },
      { ENVIRONMENT: 'test' },
    )
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ error: { code: apiCode } })
    expect(denied).toHaveBeenCalledOnce()
    expect(denied.mock.calls[0]?.slice(0, 3)).toEqual([userId, tenantId, saleId])
  },
)
