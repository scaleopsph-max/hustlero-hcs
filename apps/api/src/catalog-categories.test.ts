import { expect, it, vi } from 'vitest'
import { createApp } from './app'
const userId = '10000000-0000-4000-8000-000000000001',
  tenantId = '20000000-0000-4000-8000-000000000001'
const categoryId = '30000000-0000-4000-8000-000000000001'
const headers = {
  authorization: 'Bearer synthetic',
  'x-tenant-id': tenantId,
  'content-type': 'application/json',
  'idempotency-key': 'catalog-category-command-001',
}
function setup(code?: string, overrides: Parameters<typeof createApp>[0] = {}) {
  const command = vi.fn(async (...args: unknown[]) => {
    void args
    if (code) throw Object.assign(new Error('Private database detail'), { code })
    return { categoryId, name: 'Shoes', status: 'active' as const }
  })
  const read = vi.fn(async (...args: unknown[]) => {
    void args
    return { canManage: false, categories: [] }
  })
  const app = createApp({
    verifyAccessToken: async (token) => (token === 'synthetic' ? { userId } : null),
    loadSessionAccess: async () => [
      {
        tenantId,
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
    loadCatalogCategories: read,
    manageCatalogCategory: command,
    ...overrides,
  })
  return {
    app: { request: (path: string, init?: RequestInit) => app.request(path, init, { ENVIRONMENT: 'test' }) },
    command,
    read,
  }
}
it('requires authentication before category reads/writes', async () => {
  const { app, command, read } = setup()
  for (const method of ['GET', 'POST'])
    expect((await app.request('/v1/catalog/categories', { method })).status).toBe(401)
  expect(command).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
})
it('derives tenant membership instead of trusting a supplied tenant ID', async () => {
  const { app, command } = setup()
  const response = await app.request('/v1/catalog/categories', {
    method: 'POST',
    headers: { ...headers, 'x-tenant-id': categoryId },
    body: JSON.stringify({ action: 'create', name: 'Shoes' }),
  })
  expect(response.status).toBe(403)
  expect(command).not.toHaveBeenCalled()
})
it('returns the authorized read context without inventing write authority', async () => {
  const { app, read } = setup()
  const response = await app.request('/v1/catalog/categories', { headers })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ canManage: false, categories: [] })
  expect(read.mock.calls[0]?.slice(0, 2)).toEqual([userId, tenantId])
})
it('normalizes names and passes actor, tenant, stable key and server hash to the command', async () => {
  const { app, command } = setup()
  const response = await app.request('/v1/catalog/categories', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'create', name: ' Shoes ' }),
  })
  expect(response.status).toBe(200)
  expect(command.mock.calls[0]?.slice(0, 4)).toEqual([
    userId,
    tenantId,
    { action: 'create', name: 'Shoes' },
    headers['idempotency-key'],
  ])
})
it.each([
  { action: 'create', name: 'Shoes', tenantId },
  { action: 'archive', categoryId, name: 'Injected' },
  { action: 'rename', categoryId, name: ' ' },
])('rejects injected scope and malformed commands: %j', async (body) => {
  const { app, command } = setup()
  expect(
    (await app.request('/v1/catalog/categories', { method: 'POST', headers, body: JSON.stringify(body) })).status,
  ).toBe(400)
  expect(command).not.toHaveBeenCalled()
})
it.each([
  ['HCS09', 403],
  ['HCS10', 403],
  ['HCS12', 404],
  ['23505', 409],
  ['HCS08', 409],
  ['HCCT1', 409],
  ['HCCT2', 409],
  ['HCS11', 400],
])('sanitizes database denial %s', async (code, status) => {
  const { app } = setup(code as string)
  const response = await app.request('/v1/catalog/categories', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'create', name: 'Shoes' }),
  })
  expect(response.status).toBe(status)
  expect(await response.text()).not.toContain('Private database detail')
})
it('rejects missing keys before a write', async () => {
  const { app, command } = setup()
  expect(
    (
      await app.request('/v1/catalog/categories', {
        method: 'POST',
        headers: { authorization: 'Bearer synthetic' },
        body: JSON.stringify({ action: 'create', name: 'Shoes' }),
      })
    ).status,
  ).toBe(400)
  expect(command).not.toHaveBeenCalled()
})
