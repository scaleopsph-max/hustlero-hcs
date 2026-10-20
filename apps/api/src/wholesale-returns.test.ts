import { describe, expect, it, vi } from 'vitest'
import {
  wholesaleCreditApplyResponseSchema,
  wholesaleCreditRefundResponseSchema,
  wholesaleReturnsContextSchema,
} from '@hcs/contracts'
import { createApp } from './app'
const userId = '10000000-0000-4000-8000-000000000001',
  tenantId = '20000000-0000-4000-8000-000000000001'
const invoiceId = '30000000-0000-4000-8000-000000000001',
  lineId = '40000000-0000-4000-8000-000000000001',
  creditNoteId = '50000000-0000-4000-8000-000000000001'
const payload = {
  invoiceId,
  reason: 'Returned unused shoes',
  lines: [{ invoiceLineId: lineId, quantityMilli: 1000, returnToStock: true }],
}
const headers = {
  authorization: 'Bearer synthetic',
  'x-tenant-id': tenantId,
  'content-type': 'application/json',
  'idempotency-key': 'aw4-api-synthetic-command',
}
function setup(code?: string, overrides: Parameters<typeof createApp>[0] = {}) {
  const command = vi.fn(async () => {
    if (code) throw Object.assign(new Error('Private customer and branch data'), { code })
    return {
      invoiceId,
      creditNoteId,
      refundId: lineId,
      amountMinor: 45000,
      debtReductionMinor: 45000,
      newCustomerCreditMinor: 0,
      openDebtMinor: 405000,
      cashPayoutMinor: 0 as const,
    }
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
    postWholesaleReturn: command,
    ...overrides,
  })
  return { app, command }
}
describe('AW4 routes', () => {
  const noteHistory = wholesaleReturnsContextSchema.parse({
    canPost: false,
    canApply: false,
    canRefund: false,
    invoices: [],
    notes: [
      {
        creditNoteId,
        invoiceId,
        refundId: lineId,
        customerId: userId,
        locationId: invoiceId,
        reason: 'Private synthetic note reason',
        amountMinor: 45000,
        debtReductionMinor: 20000,
        issuedCreditMinor: 25000,
        availableCreditMinor: 25000,
        commandKey: null,
        payoutBlocked: false,
        recordedAt: '2026-10-19T00:00:00Z',
        lines: [
          {
            invoiceLineId: lineId,
            name: 'Original synthetic shoes',
            quantityMilli: 1000,
            amountMinor: 45000,
            returnToStock: false,
          },
        ],
      },
    ],
    applications: [],
    payouts: [],
    methods: [],
    sessions: [],
  })
  it('returns complete immutable note detail under authenticated scope without write authority', async () => {
    const loader = vi.fn(async (..._args: unknown[]) => structuredClone(noteHistory))
    const { app, command } = setup(undefined, { loadWholesaleReturns: loader })
    const response = await app.request('/v1/wholesale/returns', { headers }, { ENVIRONMENT: 'test' })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual(noteHistory)
    expect(loader.mock.calls[0]?.slice(0, 2)).toEqual([userId, tenantId])
    expect(command).not.toHaveBeenCalled()
  })
  it.each([
    [{ ...headers, authorization: 'Bearer wrong-account' }, 403],
    [{ ...headers, 'x-tenant-id': creditNoteId }, 403],
  ])('rejects an unauthorized note read before loading private detail', async (requestHeaders, status) => {
    const loader = vi.fn(async () => structuredClone(noteHistory))
    const { app, command } = setup(undefined, { loadWholesaleReturns: loader })
    const response = await app.request('/v1/wholesale/returns', { headers: requestHeaders }, { ENVIRONMENT: 'test' })
    expect(response.status).toBe(status)
    expect(loader).not.toHaveBeenCalled()
    expect(command).not.toHaveBeenCalled()
  })
  it('fails closed without exposing private note data when line totals do not reconcile', async () => {
    const invalid = structuredClone(noteHistory)
    invalid.notes[0]!.lines[0]!.amountMinor = 44999
    const { app, command } = setup(undefined, { loadWholesaleReturns: async () => invalid })
    const response = await app.request('/v1/wholesale/returns', { headers }, { ENVIRONMENT: 'test' })
    expect(response.status).toBe(500)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await response.text()
    expect(body).not.toContain(noteHistory.notes[0]!.reason)
    expect(body).not.toContain(noteHistory.notes[0]!.lines[0]!.name)
    expect(body).not.toContain(creditNoteId)
    expect(command).not.toHaveBeenCalled()
  })
  const creditCases = [
    {
      operation: 'apply',
      payload: { creditNoteId, invoiceId, amountMinor: 30000, reason: 'Apply existing customer credit' },
      result: { applicationId: lineId, creditNoteId, invoiceId, amountMinor: 30000 },
    },
    {
      operation: 'refund',
      payload: {
        creditNoteId,
        paymentMethodId: lineId,
        registerSessionId: null,
        referenceLastFour: '0047',
        payoutConfirmed: true,
        amountMinor: 30000,
        reason: 'Verified external payout',
      },
      result: {
        payoutId: invoiceId,
        creditNoteId,
        paymentMethodId: lineId,
        registerSessionId: null,
        referenceLastFour: '0047',
        amountMinor: 30000,
      },
    },
  ] as const
  describe.each(creditCases)('$operation endpoint', ({ operation, payload: creditPayload, result }) => {
    function creditSetup(code?: string, overrides: Parameters<typeof createApp>[0] = {}) {
      const handler = vi.fn(async (..._args: unknown[]) => {
        if (code) throw Object.assign(new Error('Private settlement details'), { code })
        return result
      })
      const { app } = setup(undefined, {
        ...(operation === 'apply'
          ? {
              applyWholesaleCredit: async (...args) => wholesaleCreditApplyResponseSchema.parse(await handler(...args)),
            }
          : {
              refundWholesaleCredit: async (...args) =>
                wholesaleCreditRefundResponseSchema.parse(await handler(...args)),
            }),
        ...overrides,
      })
      return { app, handler }
    }
    async function submit(app: ReturnType<typeof createApp>, body: unknown = creditPayload, requestHeaders = headers) {
      return app.request(
        `/v1/wholesale/credits/${operation}`,
        { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) },
        { ENVIRONMENT: 'test' },
      )
    }
    it('uses authenticated scope, exact payload/key and a stable actor-bound hash', async () => {
      const { app, handler } = creditSetup()
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await submit(app)
        expect(response.status).toBe(201)
        expect(response.headers.get('Cache-Control')).toBe('private, no-store')
        expect(await response.json()).toEqual(result)
      }
      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler.mock.calls[0]?.slice(0, 4)).toEqual([userId, tenantId, creditPayload, headers['idempotency-key']])
      expect(handler.mock.calls[0]?.[4]).toEqual(handler.mock.calls[1]?.[4])
      expect(handler.mock.calls[0]?.[4]).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/))
      // Database tests, not this mocked route test, prove a replay has one ledger effect.
    })
    it.each([
      { tenantId },
      { customerId: userId },
      { amountMinor: 0 },
      { amountMinor: -1 },
      { amountMinor: 1.5 },
      { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    ])('rejects invalid amounts and client scope overrides %j before posting', async (changes) => {
      const { app, handler } = creditSetup()
      expect((await submit(app, { ...creditPayload, ...changes })).status).toBe(400)
      expect(handler).not.toHaveBeenCalled()
    })
    it.each(['authentication', 'idempotency'] as const)('rejects missing %s before posting', async (field) => {
      const { app, handler } = creditSetup()
      const changed = { ...headers }
      if (field === 'authentication') changed.authorization = ''
      if (field === 'idempotency') changed['idempotency-key'] = ''
      expect((await submit(app, creditPayload, changed)).status).toBe(400)
      expect(handler).not.toHaveBeenCalled()
    })
    it('resolves an omitted selection only from the sole authenticated membership', async () => {
      const { app, handler } = creditSetup()
      expect((await submit(app, creditPayload, { ...headers, 'x-tenant-id': '' })).status).toBe(201)
      expect(handler.mock.calls[0]?.slice(0, 2)).toEqual([userId, tenantId])
    })
    it('rejects an explicitly selected foreign tenant instead of falling back', async () => {
      const { app, handler } = creditSetup()
      expect((await submit(app, creditPayload, { ...headers, 'x-tenant-id': invoiceId })).status).toBe(400)
      expect(handler).not.toHaveBeenCalled()
    })
    it('requires an explicit authorized selection when multiple memberships exist', async () => {
      const { app, handler } = creditSetup(undefined, {
        loadSessionAccess: async () =>
          [tenantId, invoiceId].map((id) => ({
            tenantId: id,
            tenantSlug: 'synthetic',
            tenantName: 'Synthetic',
            isOwner: true,
            employeeId: null,
            locationIds: [],
            locationCount: 1,
            permissions: [],
            entitlements: [],
          })),
      })
      expect((await submit(app, creditPayload, { ...headers, 'x-tenant-id': '' })).status).toBe(400)
      expect(handler).not.toHaveBeenCalled()
      expect((await submit(app)).status).toBe(201)
      expect(handler.mock.calls[0]?.slice(0, 2)).toEqual([userId, tenantId])
    })
    it('denies an authenticated actor with no selected-business membership', async () => {
      const { app, handler } = creditSetup(undefined, { loadSessionAccess: async () => [] })
      expect((await submit(app)).status).toBe(400)
      expect(handler).not.toHaveBeenCalled()
    })
    it.each([
      ['HCWR0', 403],
      ['HCWR2', 404],
      ['HCWR4', 409],
      ['HCWR5', 409],
      ['HCWR6', 409],
    ] as const)('sanitizes server denial %s', async (code, status) => {
      const { app } = creditSetup(code)
      const response = await submit(app)
      expect(response.status).toBe(status)
      expect(JSON.stringify(await response.json())).not.toContain('Private settlement')
    })
    if (operation === 'refund') {
      it.each([
        { payoutConfirmed: false },
        { referenceLastFour: '047' },
        { referenceLastFour: '００４７' },
        { referenceLastFour: 'a047' },
      ])('rejects unconfirmed payout or invalid last-four digits %j', async (changes) => {
        const { app, handler } = creditSetup()
        expect((await submit(app, { ...creditPayload, ...changes })).status).toBe(400)
        expect(handler).not.toHaveBeenCalled()
      })
    }
  })
  const invoice = {
    invoiceId,
    invoiceNumber: 'SYNTHETIC-001',
    customerId: creditNoteId,
    customerName: 'Synthetic customer',
    locationId: lineId,
    locationName: 'Synthetic branch',
    totalMinor: 90000,
    creditedMinor: 0,
    settledMinor: 0,
    openDebtMinor: 90000,
    valuationSupported: true,
    lines: [
      {
        invoiceLineId: lineId,
        name: 'Synthetic shoes',
        quantityMilli: 2000,
        returnedQuantityMilli: 0,
        unitPriceMinor: 45000,
        originalTotalMinor: 90000,
        priorCreditMinor: 0,
      },
    ],
  }
  it.each([
    [0, 45000, 0, 45000],
    [60000, 30000, 15000, 0],
    [90000, 0, 45000, 0],
  ])(
    'previews original-price debt/credit split at settled amount %i without posting',
    async (settledMinor, debtReductionMinor, newCustomerCreditMinor, openDebtMinor) => {
      const loader = vi.fn(async () => ({
        canPost: true,
        canApply: false,
        canRefund: false,
        invoices: [{ ...invoice, settledMinor, openDebtMinor: 90000 - settledMinor }],
        notes: [],
        applications: [],
        payouts: [],
        methods: [],
        sessions: [],
      }))
      const { app, command } = setup(undefined, { loadWholesaleReturns: loader })
      const response = await app.request(
        '/v1/wholesale/returns/preview',
        { method: 'POST', headers, body: JSON.stringify(payload) },
        { ENVIRONMENT: 'test' },
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(await response.json()).toEqual({
        totalCreditMinor: 45000,
        debtReductionMinor,
        newCustomerCreditMinor,
        openDebtMinor,
        cashPayoutMinor: 0,
      })
      expect(loader.mock.calls[0]?.slice(0, 2)).toEqual([userId, tenantId])
      expect(command).not.toHaveBeenCalled()
    },
  )
  it.each([
    [{ canPost: false }, 403],
    [{ invoices: [] }, 404],
    [{ invoices: [{ ...invoice, valuationSupported: false }] }, 409],
  ])('denies unauthorized, out-of-scope or unsupported previews without posting', async (changes, status) => {
    const { app, command } = setup(undefined, {
      loadWholesaleReturns: async () => ({
        canPost: true,
        canApply: false,
        canRefund: false,
        invoices: [invoice],
        notes: [],
        applications: [],
        payouts: [],
        methods: [],
        sessions: [],
        ...changes,
      }),
    })
    const response = await app.request(
      '/v1/wholesale/returns/preview',
      { method: 'POST', headers, body: JSON.stringify(payload) },
      { ENVIRONMENT: 'test' },
    )
    expect(response.status).toBe(status)
    expect(command).not.toHaveBeenCalled()
  })
  it('posts only server-resolved actor/tenant and validated original line inputs', async () => {
    const { app, command } = setup()
    const response = await app.request(
      '/v1/wholesale/returns',
      { method: 'POST', headers, body: JSON.stringify(payload) },
      { ENVIRONMENT: 'test' },
    )
    expect(response.status).toBe(201)
    expect(command).toHaveBeenCalledOnce()
    expect(command.mock.calls[0]?.slice(0, 4)).toEqual([userId, tenantId, payload, headers['idempotency-key']])
  })
  it.each([
    { ...payload, tenantId },
    { ...payload, amountMinor: 1 },
    { ...payload, lines: [{ ...payload.lines[0], quantityMilli: 500 }] },
  ])('rejects invalid/client-authoritative fields before database', async (body) => {
    const { app, command } = setup()
    const response = await app.request(
      '/v1/wholesale/returns',
      { method: 'POST', headers, body: JSON.stringify(body) },
      { ENVIRONMENT: 'test' },
    )
    expect(response.status).toBe(400)
    expect(command).not.toHaveBeenCalled()
  })
  it.each([
    ['HCWR0', 403],
    ['HCWR2', 404],
    ['HCWR3', 409],
    ['HCWR4', 409],
    ['HCWR5', 409],
    ['HCWR6', 409],
  ] as const)('maps %s without leaking private database details', async (code, status) => {
    const { app } = setup(code)
    const response = await app.request(
      '/v1/wholesale/returns',
      { method: 'POST', headers, body: JSON.stringify(payload) },
      { ENVIRONMENT: 'test' },
    )
    expect(response.status).toBe(status)
    expect(JSON.stringify(await response.json())).not.toContain('Private customer')
  })
  it('rejects requests without authentication or idempotency before posting', async () => {
    const { app, command } = setup()
    const response = await app.request(
      '/v1/wholesale/returns',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
      { ENVIRONMENT: 'test' },
    )
    expect(response.status).toBe(400)
    expect(command).not.toHaveBeenCalled()
  })
})
