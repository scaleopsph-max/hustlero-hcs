import { expect, it, vi } from 'vitest'
import { createApp } from './app'
const actor = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001',
  supplier = '30000000-0000-4000-8000-000000000001'
const headers = {
  authorization: 'Bearer synthetic',
  'x-tenant-id': tenant,
  'content-type': 'application/json',
  'idempotency-key': 'supplier-update-test-001',
}
it('derives supplier update tenant and rejects untrusted fields', async () => {
  const update = vi.fn(
    async (
      _actor: string,
      _tenant: string,
      id: string,
      request: {
        name: string
        contactName: string | null
        contactPhone: string | null
        contactEmail: string | null
        archive: boolean
      },
    ) => ({
      supplierId: id,
      revision: 2,
      name: request.name,
      contactName: request.contactName,
      contactPhone: request.contactPhone,
      contactEmail: request.contactEmail,
      status: request.archive ? ('archived' as const) : ('active' as const),
    }),
  )
  const app = createApp({
    verifyAccessToken: async (token) => (token === 'synthetic' ? { userId: actor } : null),
    loadSessionAccess: async () => [
      {
        tenantId: tenant,
        tenantSlug: 'synthetic',
        tenantName: 'Synthetic',
        isOwner: true,
        employeeId: null,
        locationIds: [],
        locationCount: 1,
        permissions: [],
        entitlements: [],
      },
    ],
    updateSupplier: update,
  })
  const body = {
    expectedRevision: 1,
    name: 'Supplier',
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    archive: false,
  }
  const request = (payload: unknown) =>
    app.request(
      `/v1/purchasing/suppliers/${supplier}`,
      { method: 'POST', headers, body: JSON.stringify(payload) },
      { ENVIRONMENT: 'test' },
    )
  expect((await request({ ...body, tenantId: tenant })).status).toBe(400)
  expect((await request(body)).status).toBe(200)
  expect(update).toHaveBeenCalledWith(
    actor,
    tenant,
    supplier,
    body,
    headers['idempotency-key'],
    expect.any(String),
    expect.anything(),
  )
})
