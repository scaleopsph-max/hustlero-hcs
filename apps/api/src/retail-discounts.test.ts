import { expect, it, vi } from 'vitest'
import { createApp } from './app'
import type { RetailDiscount } from '@hcs/contracts'
const actor = '10000000-0000-4000-8000-000000000001',
  tenant = '20000000-0000-4000-8000-000000000001',
  id = '30000000-0000-4000-8000-000000000001'
const body = { action: 'create', name: ' Promotion ', value: { kind: 'fixed', amountMinor: 100 }, status: 'inactive' }
const result: RetailDiscount = {
  id,
  name: 'Promotion',
  value: { kind: 'fixed', amountMinor: 100 },
  status: 'inactive',
  revision: 1,
  scope: 'retail_ticket',
  updatedAt: '2026-10-27T00:00:00Z',
}
const headers = {
  authorization: 'Bearer synthetic',
  'x-tenant-id': tenant,
  'content-type': 'application/json',
  'idempotency-key': 'discount-command-key-001',
}
function setup(code?: string) {
  const command = vi.fn(async () => {
    if (code) throw Object.assign(new Error('Private SQL detail'), { code })
    return result
  })
  const load = vi.fn(async (...args: unknown[]) =>
    args[2] === null ? { discounts: [] } : args[3] === null ? { discountId: id, versions: [result] } : result,
  )
  const app = createApp({
    verifyAccessToken: async (token) => (token === 'synthetic' ? { userId: actor } : null),
    loadSessionAccess: async () => [
      {
        tenantId: tenant,
        tenantName: 'Synthetic',
        tenantSlug: 'synthetic',
        isOwner: true,
        employeeId: null,
        locationIds: [],
        locationCount: 1,
        permissions: [],
        entitlements: [],
      },
    ],
    loadRetailDiscounts: load,
    manageRetailDiscount: command,
  })
  return {
    request: (path: string, init?: RequestInit) => app.request(path, init, { ENVIRONMENT: 'test' }),
    command,
    load,
  }
}
it('authenticates before any discount read/write', async () => {
  const { request, command, load } = setup()
  for (const method of ['GET', 'POST']) expect((await request('/v1/discounts', { method })).status).toBe(401)
  expect(command).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})
it('requires server-resolved membership for the selected business', async () => {
  const { request, command } = setup()
  expect(
    (
      await request('/v1/discounts', {
        method: 'POST',
        headers: { ...headers, 'x-tenant-id': id },
        body: JSON.stringify(body),
      })
    ).status,
  ).toBe(403)
  expect(command).not.toHaveBeenCalled()
})
it('passes normalized strict commands and verified actor/tenant to the private repository', async () => {
  const { request, command } = setup(),
    response = await request('/v1/discounts', { method: 'POST', headers, body: JSON.stringify(body) })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(result)
  expect(command.mock.calls[0]?.slice(0, 4)).toEqual([
    actor,
    tenant,
    { ...body, name: 'Promotion' },
    headers['idempotency-key'],
  ])
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})
it.each(['/v1/discounts', `/v1/discounts/${id}/versions`, `/v1/discounts/${id}/versions/1`])(
  'loads private current or exact historical snapshots: %s',
  async (path) => {
    const { request, load } = setup(),
      response = await request(path, { headers })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(load).toHaveBeenCalled()
  },
)
it.each([
  { ...body, tenantId: tenant },
  { ...body, value: { kind: 'percent', rateBps: 10000 } },
  { ...body, manualAmount: 2 },
  { ...body, status: 'archived' },
])('rejects unapproved or caller-context fields: %j', async (value) => {
  const { request, command } = setup()
  expect((await request('/v1/discounts', { method: 'POST', headers, body: JSON.stringify(value) })).status).toBe(400)
  expect(command).not.toHaveBeenCalled()
})
it('requires a valid key and bounds the request body before commands', async () => {
  const { request, command } = setup()
  expect(
    (
      await request('/v1/discounts', {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': 'short' },
        body: JSON.stringify(body),
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await request('/v1/discounts', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, name: 'x'.repeat(5000) }),
      })
    ).status,
  ).toBe(413)
  expect(command).not.toHaveBeenCalled()
})
it.each(['0', '-1', '1.5', '2147483648', 'not-a-revision'])('rejects invalid history revision %s', async (revision) => {
  const { request, load } = setup()
  expect((await request(`/v1/discounts/${id}/versions/${revision}`, { headers })).status).toBe(400)
  expect(load).not.toHaveBeenCalled()
})
it('does not permit history writes', async () => {
  const { request, command } = setup()
  expect(
    (await request(`/v1/discounts/${id}/versions`, { method: 'POST', headers, body: JSON.stringify(body) })).status,
  ).toBe(405)
  expect(command).not.toHaveBeenCalled()
})
it.each([
  ['HCDI0', 403],
  ['HCDI1', 403],
  ['HCDI2', 400],
  ['HCDI3', 409],
  ['HCDI4', 409],
  ['HCDI5', 404],
  ['23505', 409],
  ['HCS08', 409],
])('sanitizes database denial %s', async (code, status) => {
  const { request } = setup(String(code)),
    response = await request('/v1/discounts', { method: 'POST', headers, body: JSON.stringify(body) })
  expect(response.status).toBe(status)
  expect(await response.text()).not.toContain('Private SQL')
})
