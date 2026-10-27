import { expect, it, vi } from 'vitest'
import { planCatalogImport } from '@hcs/domain'
import { createApp } from './app'
const actor = '1a000000-0000-4000-8000-000000000001',
  tenant = '2a000000-0000-4000-8000-000000000001',
  jobId = '3a000000-0000-4000-8000-000000000001',
  executionId = '4a000000-0000-4000-8000-000000000001'
const source = { filename: 'execution.csv', rows: [{ product_name: 'Shoes', sku: 'SHOE-8', retail_price: '499.99' }] },
  rows = planCatalogImport(source.rows, { categories: [], products: [] })
const job = {
  id: jobId,
  filename: source.filename,
  uploaderId: actor,
  state: 'preview' as const,
  rowCount: 1,
  rejectedCount: 0,
  proposedCreates: 1,
  proposedUpdates: 0,
  createdAt: '2026-10-27T00:00:00Z',
  cancelledAt: null,
  source,
  rows,
}
const hash = 'a'.repeat(64),
  key = 'catalog-confirm-synthetic-key'
const execution = {
  id: executionId,
  jobId,
  state: 'running' as const,
  groupCount: 1,
  nextGroup: 0,
  confirmedBy: actor,
  confirmedAt: '2026-10-27T00:00:00Z',
  requestKey: key,
  reviewHash: hash,
  completedAt: null,
  results: [],
}
const headers = {
  authorization: 'Bearer synthetic',
  'x-tenant-id': tenant,
  'content-type': 'application/json',
  'idempotency-key': key,
}
function setup() {
  const review = vi.fn(async () => ({
    hash,
    groupCount: 1,
    job: structuredClone(job),
    snapshot: { categories: [], products: [] },
  }))
  const load = vi.fn(async (): Promise<{ execution: typeof execution | null }> => ({ execution: null }))
  const execute = vi.fn(async () => ({ execution }))
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
    reviewCatalogImport: review,
    loadCatalogImportExecution: load,
    executeCatalogImport: execute,
  })
  const request = (path = '/execution', body?: unknown, h: Record<string, string> = headers) =>
    app.request(
      `/v1/catalog/imports/jobs/${jobId}${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: h,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      { ENVIRONMENT: 'test' },
    )
  return { review, load, execute, request }
}
it('reviews only an unchanged server-recomputed plan', async () => {
  const { request } = setup()
  const response = await request('/review')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ hash, jobId, groupCount: 1 })
})
it('revalidates again on first confirmation before passing the bound actor/key to SQL', async () => {
  const { request, review, execute } = setup()
  expect((await request('/execution', { action: 'start', reviewHash: hash })).status).toBe(200)
  expect(review).toHaveBeenCalledOnce()
  expect(execute).toHaveBeenCalledWith(
    actor,
    tenant,
    jobId,
    { action: 'start', reviewHash: hash },
    key,
    expect.any(String),
    expect.any(Object),
  )
})
it('allows historical confirmation replay without recomputing the already-mutated catalog plan', async () => {
  const { request, review, load, execute } = setup()
  load.mockResolvedValue({ execution })
  expect((await request('/execution', { action: 'start', reviewHash: hash })).status).toBe(200)
  expect(review).not.toHaveBeenCalled()
  expect(execute).toHaveBeenCalledOnce()
})
it('rejects mismatched review hashes before first confirmation', async () => {
  const { request, execute } = setup()
  expect((await request('/execution', { action: 'start', reviewHash: 'b'.repeat(64) })).status).toBe(409)
  expect(execute).not.toHaveBeenCalled()
})
it.each(['/review', '/execution'])('rejects a changed saved plan at %s', async (path) => {
  const { request, review, execute } = setup()
  review.mockImplementation(async () => ({
    hash,
    groupCount: 1,
    job: { ...job, rows: [{ ...rows[0]!, retailPriceMinor: 1 }] },
    snapshot: { categories: [], products: [] },
  }))
  expect((await request(path, path === '/execution' ? { action: 'start', reviewHash: hash } : undefined)).status).toBe(
    409,
  )
  expect(execute).not.toHaveBeenCalled()
})
it('posts exactly the explicit group index without inventing next work', async () => {
  const { request, review, execute } = setup()
  expect((await request('/execution', { action: 'step', groupIndex: 0 })).status).toBe(200)
  expect(review).not.toHaveBeenCalled()
  expect(execute).toHaveBeenCalledWith(
    actor,
    tenant,
    jobId,
    { action: 'step', groupIndex: 0 },
    key,
    expect.any(String),
    expect.any(Object),
  )
})
it.each([
  { action: 'step', groupIndex: -1 },
  { action: 'step', groupIndex: 5000 },
  { action: 'step', groupIndex: 0, tenantId: tenant },
  { action: 'start', reviewHash: 'bad' },
  { action: 'process', groupIndex: 0 },
])('rejects forged/invalid execution commands', async (body) => {
  const { request, execute } = setup()
  expect((await request('/execution', body)).status).toBe(400)
  expect(execute).not.toHaveBeenCalled()
})
it('requires a confirmation key but not a new key per natural group retry', async () => {
  const { request } = setup()
  expect(
    (await request('/execution', { action: 'start', reviewHash: hash }, { ...headers, 'idempotency-key': '' })).status,
  ).toBe(400)
  expect(
    (await request('/execution', { action: 'step', groupIndex: 0 }, { ...headers, 'idempotency-key': '' })).status,
  ).toBe(200)
})
it('rejects unauthenticated and foreign tenant scope before execution reads', async () => {
  const { request, review, load } = setup()
  expect((await request('/review', undefined, {})).status).toBe(401)
  expect((await request('/execution', undefined, { ...headers, 'x-tenant-id': jobId })).status).toBe(403)
  expect(review).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})
it.each(['HCS09', 'HCS10', 'HCIS1', 'HCIJ2', 'HCS08'])('sanitizes guarded execution failure %s', async (code) => {
  const { request, execute } = setup()
  execute.mockRejectedValue(Object.assign(new Error('Private SQL detail'), { code }))
  const response = await request('/execution', { action: 'step', groupIndex: 0 })
  expect(response.status).toBe(code === 'HCS09' || code === 'HCS10' ? 403 : 409)
  expect(await response.text()).not.toContain('Private SQL')
})
it('bounds execution requests before parsing', async () => {
  const { request, execute } = setup()
  expect((await request('/execution', { action: 'step', groupIndex: 0, extra: 'x'.repeat(2000) })).status).toBe(413)
  expect(execute).not.toHaveBeenCalled()
})
