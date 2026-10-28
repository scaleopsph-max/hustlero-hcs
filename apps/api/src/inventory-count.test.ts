import { expect, it, vi } from 'vitest'
import { createApp } from './app'
const actor = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001'
const count = '30000000-0000-4000-8000-000000000001',
  branch = '40000000-0000-4000-8000-000000000001',
  variant = '50000000-0000-4000-8000-000000000001'
const headers = {
  authorization: 'Bearer synthetic',
  'x-tenant-id': tenant,
  'content-type': 'application/json',
  'idempotency-key': 'count-create-test-0001',
}
const fixture = {
  id: count,
  locationId: branch,
  status: 'draft' as const,
  revision: 1,
  createdAt: '2026-10-28T01:00:00Z',
  lines: [{ variantId: variant, expectedMilli: 10000, balanceVersion: 1, countedMilli: null }],
}
function setup(code?: string) {
  const create = vi.fn(async (...args: unknown[]) => {
    void args
    if (code) throw Object.assign(new Error('Private database detail'), { code })
    return fixture
  })
  const enter = vi.fn(async (...args: unknown[]) => {
    void args
    if (code) throw Object.assign(new Error('Private database detail'), { code })
    return { ...fixture, status: 'counting' as const, revision: 2 }
  })
  const read = vi.fn(async (...args: unknown[]) => {
    void args
    if (code) throw Object.assign(new Error('Private database detail'), { code })
    return fixture
  })
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
    createInventoryCount: create,
    enterInventoryCount: enter,
    loadInventoryCount: read,
  })
  return {
    app: { request: (path: string, init?: RequestInit) => app.request(path, init, { ENVIRONMENT: 'test' }) },
    create,
    enter,
    read,
  }
}
it('requires authentication and verifies the selected tenant', async () => {
  const { app, create } = setup()
  expect((await app.request('/v1/inventory/counts', { method: 'POST' })).status).toBe(401)
  expect(
    (
      await app.request('/v1/inventory/counts', {
        method: 'POST',
        headers: { ...headers, 'x-tenant-id': count },
        body: JSON.stringify({ locationId: branch, variantIds: [variant] }),
      })
    ).status,
  ).toBe(403)
  expect(create).not.toHaveBeenCalled()
})
it('passes server-derived actor/tenant and original key to the draft command', async () => {
  const { app, create } = setup()
  const response = await app.request('/v1/inventory/counts', {
    method: 'POST',
    headers,
    body: JSON.stringify({ locationId: branch, variantIds: [variant] }),
  })
  expect(response.status).toBe(201)
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(create.mock.calls[0]?.slice(0, 4)).toEqual([
    actor,
    tenant,
    { locationId: branch, variantIds: [variant] },
    headers['idempotency-key'],
  ])
})
it('rejects client scope spoofing, stale shape and missing key before database access', async () => {
  const { app, create, enter } = setup()
  expect(
    (
      await app.request('/v1/inventory/counts', {
        method: 'POST',
        headers,
        body: JSON.stringify({ locationId: branch, variantIds: [variant], tenantId: count }),
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await app.request(`/v1/inventory/counts/${count}/entries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          expectedRevision: 1,
          entries: [{ variantId: variant, countedMilli: 1, expectedMilli: 0 }],
        }),
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await app.request('/v1/inventory/counts', {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': '' },
        body: JSON.stringify({ locationId: branch, variantIds: [variant] }),
      })
    ).status,
  ).toBe(400)
  expect(create).not.toHaveBeenCalled()
  expect(enter).not.toHaveBeenCalled()
})
it('reads and enters counts with private response headers', async () => {
  const { app, read, enter } = setup()
  expect((await app.request(`/v1/inventory/counts/${count}`, { headers })).headers.get('cache-control')).toContain(
    'no-store',
  )
  const response = await app.request(`/v1/inventory/counts/${count}/entries`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedRevision: 1, entries: [{ variantId: variant, countedMilli: 8500 }] }),
  })
  expect(response.status).toBe(200)
  expect(read).toHaveBeenCalledOnce()
  expect(enter.mock.calls[0]?.slice(0, 4)).toEqual([
    actor,
    tenant,
    count,
    { expectedRevision: 1, entries: [{ variantId: variant, countedMilli: 8500 }] },
  ])
})
it.each([
  ['HCPC0', 403],
  ['HCPC1', 404],
  ['HCPC2', 400],
  ['HCPC3', 409],
  ['HCS08', 409],
])('sanitizes guarded database error %s', async (code, status) => {
  const { app } = setup(code as string)
  const response = await app.request('/v1/inventory/counts', {
    method: 'POST',
    headers,
    body: JSON.stringify({ locationId: branch, variantIds: [variant] }),
  })
  expect(response.status).toBe(status)
  expect(await response.text()).not.toContain('Private database detail')
})
