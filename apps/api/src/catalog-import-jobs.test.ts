import { expect, it, vi } from 'vitest'
import { planCatalogImport } from '@hcs/domain'
import { createApp } from './app'
const actor = '18000000-0000-4000-8000-000000000001',
  tenant = '28000000-0000-4000-8000-000000000001',
  jobId = '38000000-0000-4000-8000-000000000001'
const raw = { filename: 'test.csv', rows: [{ product_name: 'Shoes', sku: 'SHOE-8', retail_price: '499.99' }] }
const rows = planCatalogImport(raw.rows, { products: [], categories: [] })
const job = {
  id: jobId,
  filename: raw.filename,
  uploaderId: actor,
  state: 'preview' as const,
  rowCount: 1,
  rejectedCount: 0,
  proposedCreates: 1,
  proposedUpdates: 0,
  createdAt: '2026-10-27T00:00:00+00:00',
  cancelledAt: null,
  source: raw,
  rows,
}
const headers = {
  authorization: 'Bearer synthetic',
  'x-tenant-id': tenant,
  'content-type': 'application/json',
  'idempotency-key': 'synthetic-import-key-001',
}
function setup(code?: string) {
  const save = vi.fn(async () => {
    if (code) throw Object.assign(new Error('Private SQL detail'), { code })
    return { jobId, status: 'saved' as const }
  })
  const load = vi.fn(async () => ({ jobs: [job] })),
    detail = vi.fn(async () => job)
  const cancel = vi.fn(async () => ({ ...job, state: 'cancelled' as const, cancelledAt: '2026-10-27T01:00:00+00:00' }))
  const snapshot = vi.fn(async () => ({ products: [], categories: [] }))
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
    saveCatalogImportJob: save,
    loadCatalogImportJobs: load,
    loadCatalogImportJob: detail,
    cancelCatalogImportJob: cancel,
    loadCatalogImportSnapshot: snapshot,
  })
  const request = (path = '', body?: unknown, h: Record<string, string> = headers) =>
    app.request(
      `/v1/catalog/imports/jobs${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: h,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      { ENVIRONMENT: 'test' },
    )
  return { save, load, detail, cancel, snapshot, request }
}
it('saves server-derived rows using authenticated actor and authorized tenant', async () => {
  const { request, save } = setup()
  expect((await request('', raw)).status).toBe(200)
  expect(save).toHaveBeenCalledWith(
    actor,
    tenant,
    raw,
    rows,
    headers['idempotency-key'],
    expect.any(String),
    expect.objectContaining({ ENVIRONMENT: 'test' }),
  )
})
it('loads bounded history and exact detail without returning raw source in list', async () => {
  const { request } = setup()
  const response = await request()
  expect(response.status).toBe(200)
  const body = (await response.json()) as { jobs: Record<string, unknown>[] }
  expect(body.jobs[0]).not.toHaveProperty('source')
  expect((await request(`/${jobId}`)).status).toBe(200)
})
it('cancels only the authorized job without accepting forged preview or state', async () => {
  const { request, cancel } = setup()
  expect((await request(`/${jobId}`, { action: 'cancel' })).status).toBe(200)
  expect(cancel).toHaveBeenCalledWith(actor, tenant, jobId, expect.any(String), expect.any(Object))
  expect((await request(`/${jobId}`, { action: 'cancel', state: 'completed' })).status).toBe(400)
  expect(cancel).toHaveBeenCalledOnce()
})
it('rejects unauthenticated and foreign scope before job access', async () => {
  const { request, save, load, snapshot } = setup()
  expect((await request('', raw, {})).status).toBe(401)
  expect((await request('', raw, { ...headers, 'x-tenant-id': jobId })).status).toBe(403)
  expect((await request('', undefined, { ...headers, authorization: 'Bearer invalid' })).status).toBe(403)
  expect(save).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
  expect(snapshot).not.toHaveBeenCalled()
})
it.each([
  { ...raw, rows: [] },
  { ...raw, tenantId: tenant },
  { ...raw, plan: rows },
  { ...raw, rows: [{ ...raw.rows[0], quantity: '10' }] },
])('rejects malformed or forged raw input', async (body) => {
  const { request, save } = setup()
  expect((await request('', body)).status).toBe(400)
  expect(save).not.toHaveBeenCalled()
})
it('rejects invalid job IDs, missing keys and processing commands', async () => {
  const { request, save, cancel, detail } = setup()
  expect((await request('/invalid')).status).toBe(400)
  expect((await request('', raw, { ...headers, 'idempotency-key': '' })).status).toBe(400)
  expect((await request(`/${jobId}`, { action: 'process' })).status).toBe(400)
  expect(save).not.toHaveBeenCalled()
  expect(cancel).not.toHaveBeenCalled()
  expect(detail).not.toHaveBeenCalled()
})
it.each([
  ['HCS09', 403],
  ['HCS10', 403],
  ['HCS12', 404],
  ['HCS08', 409],
  ['HCS11', 400],
] as const)('sanitizes %s', async (code, status) => {
  const { request } = setup(code)
  const response = await request('', raw)
  expect(response.status).toBe(status)
  expect(await response.text()).not.toContain('Private SQL')
})
it('bounds saved preview requests', async () => {
  const { request, save } = setup()
  expect((await request('', { ...raw, filename: 'x'.repeat(6 * 1024 * 1024 + 1) })).status).toBe(413)
  expect(save).not.toHaveBeenCalled()
})
it('bounds cancellation input before parsing it', async () => {
  const { request, cancel } = setup()
  expect((await request(`/${jobId}`, { action: 'cancel', extra: 'x'.repeat(2000) })).status).toBe(413)
  expect(cancel).not.toHaveBeenCalled()
})
