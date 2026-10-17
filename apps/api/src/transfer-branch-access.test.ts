import { expect, it, vi } from 'vitest'
import { createApp } from './app'

const userId = '10000000-0000-4000-8000-000000000001'
const tenantId = '20000000-0000-4000-8000-000000000001'
const id = '30000000-0000-4000-8000-000000000001'
const otherId = '30000000-0000-4000-8000-000000000002'

it.each([
  ['', 'HCS55', 404, 'TRANSFER_REFERENCE_NOT_FOUND'],
  ['', 'HCS50', 403, 'TRANSFER_ACCESS_DENIED'],
  [`/${id}/dispatch`, 'HCS55', 409, 'TRANSFER_STATE_CONFLICT'],
  [`/${id}/dispatch`, 'HCS50', 403, 'TRANSFER_ACCESS_DENIED'],
  [`/${id}/dispatch`, 'HCS08', 409, 'IDEMPOTENCY_KEY_CONFLICT'],
  [`/${id}/receive`, 'HCS55', 404, 'TRANSFER_NOT_RECEIVABLE'],
  [`/${id}/receive`, 'HCS50', 403, 'TRANSFER_ACCESS_DENIED'],
  [`/${id}/receive`, 'HCS08', 409, 'IDEMPOTENCY_KEY_CONFLICT'],
] as const)('maps transfer %s denial %s safely', async (suffix, code, status, apiCode) => {
  const denied = vi.fn(async () => {
    throw Object.assign(new Error('Private other-branch transfer costs'), { code })
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
    createTransfer: denied,
    dispatchTransfer: denied,
    receiveTransfer: denied,
  })
  const body = suffix.endsWith('/receive')
    ? { items: [{ stockTransferItemId: id, quantityMilli: 1000 }] }
    : suffix.endsWith('/dispatch')
      ? {}
      : {
          transferNumber: 'SYNTHETIC',
          sourceLocationId: id,
          destinationLocationId: otherId,
          items: [{ variantId: id, quantityMilli: 1000 }],
        }
  const response = await app.request(
    `/v1/transfers${suffix}`,
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
