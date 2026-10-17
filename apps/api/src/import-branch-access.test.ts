import { expect, it, vi } from 'vitest'
import { createApp } from './app'

const userId = '10000000-0000-4000-8000-000000000001'
const tenantId = '20000000-0000-4000-8000-000000000001'

it.each([
  ['HCS32', 404, 'INVENTORY_IMPORT_NOT_FOUND'],
  ['HCS17', 403, 'INVENTORY_ACCESS_DENIED'],
  ['HCS08', 409, 'IDEMPOTENCY_KEY_CONFLICT'],
] as const)('maps import preview scope denial %s safely', async (code, status, apiCode) => {
  const denied = vi.fn(async () => {
    throw Object.assign(new Error('Private other-branch import metadata'), { code })
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
    previewInventoryImport: denied,
  })
  const response = await app.request(
    '/v1/inventory/imports/preview',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer synthetic',
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-preview-0001',
      },
      body: JSON.stringify({
        filename: 'scope.csv',
        cutoverAt: '2026-10-17T00:00:00.000Z',
        rows: [
          {
            rowNumber: 2,
            branchCode: 'MAIN',
            sku: 'SYNTHETIC',
            barcode: '',
            quantityOnHand: '2',
            unitCost: '3.35',
            reorderLevel: '1',
            reservedQuantity: '',
            damagedQuantity: '',
            inTransitQuantity: '',
            sourceReference: '',
          },
        ],
      }),
    },
    { ENVIRONMENT: 'test' },
  )
  expect(response.status).toBe(status)
  const result = await response.json()
  expect(result).toMatchObject({ error: { code: apiCode } })
  expect(JSON.stringify(result)).not.toContain('Private other-branch')
  expect(denied).toHaveBeenCalledOnce()
  expect(denied.mock.calls[0]?.slice(0, 2)).toEqual([userId, tenantId])
})
