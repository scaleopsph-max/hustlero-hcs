import { describe, expect, it, vi } from 'vitest'
import { apiErrorResponseSchema } from '@hcs/contracts'

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
const creditPayload = {
  customerId: invoiceId,
  paymentTerm: 'net_7' as const,
  creditLimitMinor: 500000,
  reason: 'Approved customer credit configuration',
}
const creditResponse = {
  settingsId: response.chargeId,
  customerId: invoiceId,
  paymentTerm: 'net_7' as const,
  creditLimitMinor: 500000,
  revision: 1,
  recordedAt: '2026-10-10T12:00:00Z',
}

function setup(code?: string) {
  const record = vi.fn(async () => {
    if (code) throw Object.assign(new Error('Database rejected command'), { code })
    return response
  })
  const load = vi.fn(async () => ({ canRecordOpening: true, invoices: [] }))
  const saveCredit = vi.fn(async () => {
    if (code) throw Object.assign(new Error('Database rejected command'), { code })
    return creditResponse
  })
  const loadCredit = vi.fn(async () => ({ canManage: true, customers: [] }))
  const loadPayments = vi.fn(async () => {
    if (code) throw Object.assign(new Error('Private history database details'), { code })
    return { canRecord: false, invoices: [], paymentMethods: [], payments: [] }
  })
  const recordPayment = vi.fn(async () => {
    if (code) throw Object.assign(new Error('Private payment database details'), { code })
    return {
      paymentId: response.chargeId,
      customerId: invoiceId,
      amountMinor: 10000,
      allocationCount: 1,
      recordedAt: '2026-10-10T14:00:00Z',
    }
  })
  const overrideCommand = vi.fn(async (_userId: string, _tenantId: string, operation: 'approve' | 'revoke') => {
    if (code) throw Object.assign(new Error('Private database approval details'), { code })
    return {
      overrideId: response.chargeId,
      status: operation === 'approve' ? ('approved' as const) : ('revoked' as const),
    }
  })
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
    saveWholesaleCreditSettings: saveCredit,
    loadWholesaleCreditSettings: loadCredit,
    loadWholesaleCreditOverrides: async () => ({ canApprove: true, overrides: [] }),
    commandWholesaleCreditOverride: overrideCommand,
    recordWholesalePayment: recordPayment,
    loadWholesalePayments: loadPayments,
    confirmWholesaleOrder: async () => {
      throw Object.assign(new Error('Private database details'), { code })
    },
    fulfillWholesaleOrder: async () => {
      throw Object.assign(new Error('Private database details'), { code })
    },
  })
  return { app, record, load, saveCredit, loadCredit, overrideCommand, recordPayment, loadPayments }
}

function headers(tenant = tenantId) {
  return {
    authorization: 'Bearer valid',
    'x-tenant-id': tenant,
    'idempotency-key': 'opening-receivable-001',
    'content-type': 'application/json',
  }
}

describe('wholesale payments API', () => {
  it('loads history through authenticated server context', async () => {
    const { app, loadPayments } = setup()
    const result = await app.request('/v1/wholesale/payments', { headers: headers() }, bindings)
    expect(result.status).toBe(200)
    expect(loadPayments).toHaveBeenCalledWith(userId, tenantId, bindings)
    expect(await result.json()).toEqual({ canRecord: false, invoices: [], paymentMethods: [], payments: [] })
  })
  it('denies foreign tenant history before database access', async () => {
    const { app, loadPayments } = setup()
    const result = await app.request('/v1/wholesale/payments', { headers: headers(invoiceId) }, bindings)
    expect(result.status).toBe(403)
    expect(loadPayments).not.toHaveBeenCalled()
  })
  it('sanitizes history access errors', async () => {
    const { app } = setup('HCSQ0')
    const result = await app.request('/v1/wholesale/payments', { headers: headers() }, bindings)
    expect(result.status).toBe(403)
    expect(await result.text()).not.toContain('Private history')
  })
  const payment = {
    customerId: invoiceId,
    paymentMethodId: response.chargeId,
    amountMinor: 10000,
    reference: 'Received cash test',
    allocations: [{ invoiceId, amountMinor: 10000 }],
  }
  it('records explicitly received amounts using authenticated server context', async () => {
    const { app, recordPayment } = setup()
    const result = await app.request(
      '/v1/wholesale/payments',
      { method: 'POST', headers: headers(), body: JSON.stringify(payment) },
      bindings,
    )
    expect(result.status).toBe(201)
    expect(recordPayment).toHaveBeenCalledWith(
      userId,
      tenantId,
      payment,
      'opening-receivable-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })
  it.each([
    { ...payment, tenantId },
    { ...payment, amountMinor: 0 },
    { ...payment, amountMinor: 1.5 },
    { ...payment, allocations: [] },
    { ...payment, allocations: [{ invoiceId, amountMinor: 9999 }] },
    {
      ...payment,
      allocations: [
        { invoiceId, amountMinor: 5000 },
        { invoiceId, amountMinor: 5000 },
      ],
    },
    { ...payment, reference: '' },
    { ...payment, recordedAt: '2026-10-09T00:00:00Z' },
  ])('rejects invalid allocation or client projections %j', async (body) => {
    const { app, recordPayment } = setup()
    expect(
      (
        await app.request(
          '/v1/wholesale/payments',
          { method: 'POST', headers: headers(), body: JSON.stringify(body) },
          bindings,
        )
      ).status,
    ).toBe(400)
    expect(recordPayment).not.toHaveBeenCalled()
  })
  it.each([
    ['HCAP1', 403],
    ['HCAP2', 400],
    ['HCAP3', 404],
    ['HCAP4', 409],
    ['HCAP5', 409],
    ['HCS08', 409],
  ])('maps payment error %s safely', async (code, status) => {
    const { app } = setup(code as string)
    const result = await app.request(
      '/v1/wholesale/payments',
      { method: 'POST', headers: headers(), body: JSON.stringify(payment) },
      bindings,
    )
    expect(result.status).toBe(status)
    expect(JSON.stringify(await result.json())).not.toContain('Private payment')
  })
  it('denies a foreign tenant before recording cash', async () => {
    const { app, recordPayment } = setup()
    expect(
      (
        await app.request(
          '/v1/wholesale/payments',
          { method: 'POST', headers: headers(response.chargeId), body: JSON.stringify(payment) },
          bindings,
        )
      ).status,
    ).toBe(400)
    expect(recordPayment).not.toHaveBeenCalled()
  })
})

describe('wholesale credit override API', () => {
  it('loads the authorized approval history', async () => {
    const { app } = setup()
    const result = await app.request('/v1/wholesale/credit-overrides', { headers: headers() }, bindings)
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ canApprove: true, overrides: [] })
  })
  const approval = {
    salesOrderId: invoiceId,
    action: 'confirm',
    approvedExcessMinor: 50000,
    expiresAt: '2026-10-11T00:00:00Z',
    reason: 'Approved scoped exception',
  }
  it('derives authenticated context and forwards only explicit approval scope', async () => {
    const { app, overrideCommand } = setup()
    const result = await app.request(
      '/v1/wholesale/credit-overrides',
      { method: 'POST', headers: headers(), body: JSON.stringify(approval) },
      bindings,
    )
    expect(result.status).toBe(201)
    expect(overrideCommand).toHaveBeenCalledWith(
      userId,
      tenantId,
      'approve',
      approval,
      expect.any(String),
      expect.any(String),
      expect.any(String),
      bindings,
    )
  })
  it('records explicit revoke reason and server-owned path identifier', async () => {
    const { app, overrideCommand } = setup()
    const result = await app.request(
      `/v1/wholesale/credit-overrides/${response.chargeId}/revoke`,
      { method: 'POST', headers: headers(), body: JSON.stringify({ reason: 'Withdraw approval' }) },
      bindings,
    )
    expect(result.status).toBe(201)
    expect(overrideCommand).toHaveBeenCalledWith(
      userId,
      tenantId,
      'revoke',
      { overrideId: response.chargeId, reason: 'Withdraw approval' },
      expect.any(String),
      expect.any(String),
      expect.any(String),
      bindings,
    )
  })
  it.each([
    { ...approval, tenantId },
    { ...approval, approvedBy: userId },
    { ...approval, approvedExcessMinor: 0 },
    { ...approval, approvedExcessMinor: 1.5 },
    { ...approval, action: 'all' },
    { ...approval, expiresAt: '2026-10-11T00:00:00' },
  ])('rejects malformed or server-owned approval %#', async (payload) => {
    const { app, overrideCommand } = setup()
    expect(
      (
        await app.request(
          '/v1/wholesale/credit-overrides',
          { method: 'POST', headers: headers(), body: JSON.stringify(payload) },
          bindings,
        )
      ).status,
    ).toBe(400)
    expect(overrideCommand).not.toHaveBeenCalled()
  })
  it.each([
    ['HCCO1', 403],
    ['HCCO2', 400],
    ['HCCO3', 404],
    ['HCCO4', 409],
    ['HCCO5', 400],
    ['HCCO6', 409],
    ['HCS08', 409],
  ])('maps %s without private details', async (code, status) => {
    const { app } = setup(code as string)
    const result = await app.request(
      '/v1/wholesale/credit-overrides',
      { method: 'POST', headers: headers(), body: JSON.stringify(approval) },
      bindings,
    )
    expect(result.status).toBe(status)
    expect(JSON.stringify(await result.json())).not.toContain('Private database')
  })
  it('denies foreign tenant before executing approval', async () => {
    const { app, overrideCommand } = setup()
    expect(
      (
        await app.request(
          '/v1/wholesale/credit-overrides',
          { method: 'POST', headers: headers(response.chargeId), body: JSON.stringify(approval) },
          bindings,
        )
      ).status,
    ).toBe(400)
    expect(overrideCommand).not.toHaveBeenCalled()
  })
})

describe('wholesale credit enforcement errors', () => {
  it.each(['HCCR1', 'HCCR2', 'HCCR3', 'HCCR4'])('returns a controlled credit conflict for %s', async (code) => {
    const { app } = setup(code)
    for (const action of ['confirm', 'fulfill']) {
      const result = await app.request(
        `/v1/wholesale/orders/${invoiceId}/${action}`,
        {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(
            action === 'confirm' ? {} : { lines: [{ salesOrderLineId: invoiceId, quantityMilli: 1000 }] },
          ),
        },
        bindings,
      )
      expect(result.status).toBe(409)
      const body = apiErrorResponseSchema.parse(await result.json())
      expect(body.error.code).toBe(`WHOLESALE_CREDIT_${code}`)
      expect(body.error.message).not.toContain('Private database details')
    }
  })
})

describe('wholesale credit settings API', () => {
  it('uses authenticated server context for credit revisions', async () => {
    const { app, saveCredit } = setup()
    const result = await app.request(
      '/v1/wholesale/credit-settings',
      { method: 'POST', headers: headers(), body: JSON.stringify(creditPayload) },
      bindings,
    )
    expect(result.status).toBe(201)
    expect(await result.json()).toEqual(creditResponse)
    expect(saveCredit).toHaveBeenCalledWith(
      userId,
      tenantId,
      creditPayload,
      'opening-receivable-001',
      expect.any(String),
      expect.any(String),
      bindings,
    )
  })

  it('reads authorized customer configuration', async () => {
    const { app, loadCredit } = setup()
    const result = await app.request('/v1/wholesale/credit-settings', { headers: headers() }, bindings)
    expect(result.status).toBe(200)
    expect(loadCredit).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it.each([
    { ...creditPayload, creditLimitMinor: -1 },
    { ...creditPayload, creditLimitMinor: 1.5 },
    { ...creditPayload, paymentTerm: 'cash' },
    { ...creditPayload, tenantId },
    { ...creditPayload, revision: 1 },
  ])('rejects invalid or server-owned credit settings %#', async (payload) => {
    const { app, saveCredit } = setup()
    const result = await app.request(
      '/v1/wholesale/credit-settings',
      { method: 'POST', headers: headers(), body: JSON.stringify(payload) },
      bindings,
    )
    expect(result.status).toBe(400)
    expect(saveCredit).not.toHaveBeenCalled()
  })

  it('rejects foreign tenant selection before reading or writing', async () => {
    const { app, saveCredit, loadCredit } = setup()
    const result = await app.request(
      '/v1/wholesale/credit-settings',
      { method: 'POST', headers: headers('20000000-0000-4000-8000-000000000099'), body: JSON.stringify(creditPayload) },
      bindings,
    )
    expect(result.status).toBe(400)
    const read = await app.request('/v1/wholesale/credit-settings', { headers: {} }, bindings)
    expect(read.status).toBe(403)
    expect(saveCredit).not.toHaveBeenCalled()
    expect(loadCredit).not.toHaveBeenCalled()
  })

  it.each([
    ['HCCS1', 403],
    ['HCAR1', 403],
    ['HCCS2', 400],
    ['HCCS3', 404],
    ['HCS08', 409],
    ['HCSQ0', 403],
  ] as const)('maps credit command denial %s', async (code, status) => {
    const { app } = setup(code)
    const result = await app.request(
      '/v1/wholesale/credit-settings',
      { method: 'POST', headers: headers(), body: JSON.stringify(creditPayload) },
      bindings,
    )
    expect(result.status).toBe(status)
  })
})

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
