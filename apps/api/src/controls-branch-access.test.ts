import { expect, it, vi } from 'vitest'
import { createApp } from './app'

const userId = '10000000-0000-4000-8000-000000000001'
const tenantId = '20000000-0000-4000-8000-000000000001'
const alertId = '30000000-0000-4000-8000-000000000001'

it.each([
  ['GET', '/v1/alerts', 'HCSE0', 403, 'CONTROL_ACCESS_DENIED'],
  ['PATCH', `/v1/alerts/${alertId}`, 'HCSE0', 403, 'CONTROL_ACCESS_DENIED'],
  ['PATCH', `/v1/alerts/${alertId}`, 'HCSE2', 404, 'CONTROL_RECORD_NOT_FOUND'],
  ['GET', '/v1/audit-activity?from=2026-10-17&to=2026-10-17', 'HCSE0', 403, 'CONTROL_ACCESS_DENIED'],
  ['GET', '/v1/audit-activity?from=2026-10-17&to=2026-10-17', 'HCSE2', 404, 'CONTROL_RECORD_NOT_FOUND'],
] as const)('maps %s %s branch denial %s safely', async (method, path, code, status, apiCode) => {
  const denied = vi.fn(async () => {
    throw Object.assign(new Error('Private other-branch alert or audit metadata'), { code })
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
    loadAlertCenter: denied,
    updateAlertStatus: denied,
    loadAuditActivity: denied,
  })
  const response = await app.request(
    path,
    {
      method,
      headers: { Authorization: 'Bearer synthetic', 'X-Tenant-Id': tenantId, 'Content-Type': 'application/json' },
      ...(method === 'PATCH' ? { body: JSON.stringify({ status: 'resolved', note: 'Synthetic' }) } : {}),
    },
    { ENVIRONMENT: 'test' },
  )
  expect(response.status).toBe(status)
  const result = await response.json()
  expect(result).toMatchObject({ error: { code: apiCode } })
  expect(JSON.stringify(result)).not.toContain('Private other-branch')
  expect(denied).toHaveBeenCalledOnce()
  expect(denied.mock.calls[0]?.slice(0, 2)).toEqual([userId, tenantId])
  if (method === 'GET') expect(response.headers.get('Cache-Control')).toBe('private, no-store')
})
