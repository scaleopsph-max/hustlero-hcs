import { expect, it, vi } from 'vitest'
import { createApp } from './app'
const userId = '10000000-0000-4000-8000-000000000001'
const tenantId = '20000000-0000-4000-8000-000000000001'
const filter = '?from=2026-10-16&to=2026-10-16&channel=pos'
function setup(code?: string) {
  const loader = vi.fn(async () => {
    if (code) throw Object.assign(new Error('Private database detail'), { code })
    return { timezone: 'Asia/Manila', locations: [], rows: [] }
  })
  const app = createApp({
    verifyAccessToken: async (token) => (token === 'valid' ? { userId } : null),
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
    loadPosPaymentReferenceReport: loader,
    loadWholesalePaymentReferenceReport: loader,
  })
  return { app, loader }
}
it('requires authentication and does not call the report loader anonymously', async () => {
  const { app, loader } = setup()
  const response = await app.request('/v1/reports/pos-payment-references' + filter, {}, { ENVIRONMENT: 'test' })
  expect(response.status).toBe(403)
  expect(loader).not.toHaveBeenCalled()
})
it.each(['HCSD0', 'HCAR1'])('keeps wholesale reports independently gated by %s', async (code) => {
  const { app, loader } = setup(code)
  const response = await app.request(
    '/v1/reports/wholesale-payment-references?from=2026-10-17&to=2026-10-17&channel=wholesale',
    { headers: { Authorization: 'Bearer valid', 'X-Tenant-Id': tenantId } },
    { ENVIRONMENT: 'test' },
  )
  expect(response.status).toBe(403)
  expect(await response.text()).not.toContain('Private database detail')
  expect(loader).toHaveBeenCalledOnce()
})
it('passes authenticated server scope and parsed filters, ignoring a query tenant override', async () => {
  const { app, loader } = setup()
  const response = await app.request(
    '/v1/reports/pos-payment-references' + filter + '&tenantId=foreign',
    {
      headers: { Authorization: 'Bearer valid', 'X-Tenant-Id': tenantId },
    },
    { ENVIRONMENT: 'test' },
  )
  expect(response.status).toBe(200)
  expect(loader).toHaveBeenCalledWith(
    userId,
    tenantId,
    {
      from: '2026-10-16',
      to: '2026-10-16',
      locationId: null,
      channel: 'pos',
    },
    expect.anything(),
  )
})
it('maps database branch denial without leaking private error text', async () => {
  const { app } = setup('HCSD0')
  const response = await app.request(
    '/v1/reports/pos-payment-references' + filter,
    {
      headers: { Authorization: 'Bearer valid', 'X-Tenant-Id': tenantId },
    },
    { ENVIRONMENT: 'test' },
  )
  expect(response.status).toBe(403)
  expect(await response.text()).not.toContain('Private database detail')
})
