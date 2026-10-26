import { expect, it, vi } from 'vitest'
import { createApp } from './app'
import { catalogImportPreviewResponseSchema } from '@hcs/contracts'
const user = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001'
const category = '30000000-0000-4000-8000-000000000001',
  product = '40000000-0000-4000-8000-000000000001',
  variant = '50000000-0000-4000-8000-000000000001'
const body = {
  filename: 'catalog.csv',
  rows: [{ product_name: 'Shoes', sku: 'SHOE-8', category: 'Shoes', retail_price: '499.99' }],
}
const headers = { authorization: 'Bearer synthetic', 'x-tenant-id': tenant, 'content-type': 'application/json' }
function setup(code?: string) {
  const snapshot = vi.fn(async () => {
    if (code) throw Object.assign(new Error('Private snapshot detail'), { code })
    return {
      categories: [{ id: category, name: 'Shoes', status: 'active' as const }],
      products: [
        {
          id: product,
          name: 'Existing',
          description: null,
          categoryId: category,
          status: 'active' as const,
          variants: [{ id: variant, sku: 'OLD-8', isActive: false, trackInventory: true, barcodes: ['480001'] }],
        },
      ],
    }
  })
  const app = createApp({
    verifyAccessToken: async (token) => (token === 'synthetic' ? { userId: user } : null),
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
    loadCatalogImportSnapshot: snapshot,
  })
  return {
    snapshot,
    request: (data: unknown = body, requestHeaders: Record<string, string> = headers) =>
      app.request(
        '/v1/catalog/imports/preview',
        { method: 'POST', headers: requestHeaders, body: JSON.stringify(data) },
        { ENVIRONMENT: 'test' },
      ),
  }
}
it('derives create/update intent and exact cents from the authorized full snapshot', async () => {
  const { request, snapshot } = setup()
  const response = await request()
  expect(response.status).toBe(200)
  const data = catalogImportPreviewResponseSchema.parse(await response.json())
  expect(data.filename).toBe('catalog.csv')
  expect(data.rows[0]).toMatchObject({ action: 'create_product', categoryId: category, retailPriceMinor: 49999 })
  expect(snapshot).toHaveBeenCalledOnce()
})
it('does not hide inactive SKU conflicts by using the active-only catalog list', async () => {
  const { request } = setup()
  const response = await request({ ...body, rows: [{ ...body.rows[0], sku: 'OLD-8' }] })
  const data = catalogImportPreviewResponseSchema.parse(await response.json())
  expect(data.rows).toHaveLength(1)
  expect(data.rows[0]!.action).toBeNull()
  expect(data.rows[0]!.issues).toContainEqual({ code: 'INACTIVE_EXISTING_ITEM', field: 'sku' })
})
it('rejects unauthenticated and foreign-tenant requests before loading snapshots', async () => {
  const { request, snapshot } = setup()
  expect((await request(body, {})).status).toBe(401)
  expect((await request(body, { ...headers, 'x-tenant-id': category })).status).toBe(403)
  expect(snapshot).not.toHaveBeenCalled()
})
it.each([
  { ...body, tenantId: tenant },
  { ...body, rows: [] },
  { ...body, rows: [{ ...body.rows[0], quantity: '100' }] },
  { ...body, rows: Array.from({ length: 5001 }, () => body.rows[0]) },
])('rejects injected fields or invalid limits before preview', async (data) => {
  const { request, snapshot } = setup()
  expect((await request(data)).status).toBe(400)
  expect(snapshot).not.toHaveBeenCalled()
})
it.each(['HCS09', 'HCS10'])('sanitizes denied/unavailable snapshot %s', async (code) => {
  const { request } = setup(code)
  const response = await request()
  expect(response.status).toBe(403)
  expect(await response.text()).not.toContain('Private snapshot detail')
})
it('bounds request size before snapshot reads', async () => {
  const { request, snapshot } = setup()
  expect((await request({ filename: 'x'.repeat(6 * 1024 * 1024 + 1), rows: [] })).status).toBe(413)
  expect(snapshot).not.toHaveBeenCalled()
})
