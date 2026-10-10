import { describe, expect, it, vi } from 'vitest'

import { createApp } from './app'

const userId = '10000000-0000-4000-8000-000000000001'
const tenantId = '20000000-0000-4000-8000-000000000001'
const invoiceId = '30000000-0000-4000-8000-000000000001'
const payload = { invoiceId, dueDate: '2026-10-10', reason: 'Confirmed unpaid opening invoice' }
const response = {
  chargeId: '40000000-0000-4000-8000-000000000001',
  invoiceId,
  amountMinor: 225000,
  dueDate: payload.dueDate,
  status: 'unpaid' as const,
}
const bindings = { ENVIRONMENT: 'test' }

function setup(code?: string) {
  const record = vi.fn(async () => {
    if (code) throw Object.assign(new Error('Database rejected command'), { code })
    return response
  })
  const load = vi.fn(async () => ({ canRecordOpening: true, invoices: [] }))
  const app = createApp({
    verifyAccessToken: async (token) => (token === 'valid' ? { userId } : null),
    loadSessionAccess: async () => [
      {
        tenantId,
        tenantSlug: 'fixture',
        tenantName: 'Fixture',
        isOwner: true,
        employeeId: null,
        locationIds: [],
        locationCount: 0,
        permissions: [],
        entitlements: [],
      },
    ],
    loadWholesaleReceivables: load,
    recordWholesaleOpeningReceivable: record,
  })
  return { app, record, load }
}

function headers(tenant = tenantId) {
  return {
    authorization: 'Bearer valid',
    'x-tenant-id': tenant,
    'idempotency-key': 'opening-receivable-001',
    'content-type': 'application/json',
  }
}

describe('wholesale opening receivable API', () => {
  it('passes server-resolved tenant and authenticated actor to the atomic command', async () => {
    const { app, record } = setup()
    const result = await app.request(
      '/v1/wholesale/receivables/opening',
      { method: 'POST', headers: headers(), body: JSON.stringify(payload) },
      bindings,
    )
    expect(result.status).toBe(201)
    expect(await result.json()).toEqual(response)
    expect(record).toHaveBeenCalledWith(
      userId,
      tenantId,
      payload,
      'opening-receivable-001',
      expect.any(String),
      expect.any(String),
      bindings,
    )
  })

  it('loads the authorized receivable context', async () => {
    const { app, load } = setup()
    const result = await app.request('/v1/wholesale/receivables', { headers: headers() }, bindings)
    expect(result.status).toBe(200)
    expect(load).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it('denies unauthenticated or foreign-tenant reads and commands before reaching PostgreSQL', async () => {
    const { app, record, load } = setup()
    for (const requestHeaders of [{}, headers('20000000-0000-4000-8000-000000000099')]) {
      const read = await app.request('/v1/wholesale/receivables', { headers: requestHeaders }, bindings)
      expect(read.status).toBe(403)
      const write = await app.request(
        '/v1/wholesale/receivables/opening',
        { method: 'POST', headers: requestHeaders, body: JSON.stringify(payload) },
        bindings,
      )
      expect(write.status).toBe(400)
    }
    expect(record).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })

  it.each([
    { ...payload, tenantId },
    { ...payload, amountMinor: 1 },
    { ...payload, dueDate: '2026-02-30' },
    { ...payload, reason: '' },
  ])('rejects invalid or tampered request %#', async (body) => {
    const { app, record } = setup()
    const result = await app.request(
      '/v1/wholesale/receivables/opening',
      { method: 'POST', headers: headers(), body: JSON.stringify(body) },
      bindings,
    )
    expect(result.status).toBe(400)
    expect(record).not.toHaveBeenCalled()
  })

  it('rejects missing idempotency key', async () => {
    const { app, record } = setup()
    const result = await app.request(
      '/v1/wholesale/receivables/opening',
      {
        method: 'POST',
        headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
      bindings,
    )
    expect(result.status).toBe(400)
    expect(record).not.toHaveBeenCalled()
  })

  it.each([
    ['HCAR1', 403],
    ['HCAR2', 400],
    ['HCAR3', 404],
    ['HCAR4', 409],
    ['HCS08', 409],
    ['HCSQ0', 403],
  ] as const)('maps database denial %s to %s', async (code, status) => {
    const { app } = setup(code)
    const result = await app.request(
      '/v1/wholesale/receivables/opening',
      { method: 'POST', headers: headers(), body: JSON.stringify(payload) },
      bindings,
    )
    expect(result.status).toBe(status)
  })
})
