import { expect, it, vi } from 'vitest'
import { createApp } from './app'

const userId = '10000000-0000-4000-8000-000000000001'
const tenantId = '20000000-0000-4000-8000-000000000001'
const id = '30000000-0000-4000-8000-000000000001'

it.each([
  ['', 'HCS36', 404, 'PURCHASING_REFERENCE_NOT_FOUND'],
  ['', 'HCS30', 403, 'PURCHASING_ACCESS_DENIED'],
  [`/${id}/send`, 'HCS36', 404, 'PURCHASE_ORDER_NOT_FOUND'],
  [`/${id}/send`, 'HCS30', 403, 'PURCHASING_ACCESS_DENIED'],
  [`/${id}/receive`, 'HCS36', 404, 'PURCHASE_ORDER_NOT_FOUND'],
  [`/${id}/receive`, 'HCS30', 403, 'PURCHASING_ACCESS_DENIED'],
] as const)('maps purchasing %s denial %s safely', async (suffix, code, status, apiCode) => {
  const denied = vi.fn(async () => {
    throw Object.assign(new Error('Private other-branch supplier and cost'), { code })
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
    createPurchaseOrder: denied,
    sendPurchaseOrder: denied,
    receivePurchaseOrder: denied,
  })
  const body = suffix.endsWith('/receive')
    ? { lines: [{ purchaseOrderLineId: id, quantityMilli: 1000 }] }
    : suffix.endsWith('/send')
      ? {}
      : {
          supplierId: id,
          locationId: id,
          orderNumber: 'SYNTHETIC',
          lines: [{ variantId: id, quantityMilli: 1000, unitCostMinor: 50000 }],
        }
  const response = await app.request(
    `/v1/purchasing/orders${suffix}`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer synthetic',
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-scope-denial',
      },
      body: JSON.stringify(body),
    },
    { ENVIRONMENT: 'test' },
  )
  expect(response.status).toBe(status)
  const result = await response.json()
  expect(result).toMatchObject({ error: { code: apiCode } })
  expect(JSON.stringify(result)).not.toContain('Private other-branch')
  expect(denied).toHaveBeenCalledOnce()
})
