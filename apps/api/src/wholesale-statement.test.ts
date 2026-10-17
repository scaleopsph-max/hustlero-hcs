import { describe, it, expect, vi } from 'vitest'
import { wholesaleStatementSchema, wholesaleStatementQuerySchema } from '@hcs/contracts'
import { statementCsv } from '../../backoffice/src/lib/wholesale-statement'
import { createApp } from './app'
const userId = '10000000-0000-4000-8000-000000000001',
  tenantId = '20000000-0000-4000-8000-000000000001'
const id = '30000000-0000-4000-8000-000000000001'
const report = {
  scope: {
    asOfDate: '2026-10-11',
    asOf: '2026-10-11T04:00:00Z',
    generatedAt: '2026-10-11T04:00:00Z',
    timezone: 'Asia/Manila',
    customerId: null,
    locationId: null,
  },
  customers: [],
  locations: [],
  summary: {
    balanceMinor: 10000,
    currentMinor: 10000,
    days1To30Minor: 0,
    days31To60Minor: 0,
    days61To90Minor: 0,
    over90Minor: 0,
    unclassifiedCount: 0,
    unclassifiedMinor: 0,
  },
  invoices: [
    {
      invoiceId: id,
      invoiceNumber: '=SYN',
      saleId: id,
      customerId: id,
      customerName: 'Synthetic',
      locationId: id,
      locationName: 'Main',
      businessDate: '2026-10-11',
      classification: 'invoice' as const,
      chargedMinor: 15000,
      paidMinor: 5000,
      balanceMinor: 10000,
      dueDate: '2026-10-11',
      daysOverdue: 0,
      band: 'current' as const,
    },
  ],
  entries: [
    {
      entryId: 'charge',
      recordedAt: '2026-10-11T01:00:00Z',
      invoiceId: id,
      invoiceNumber: '=SYN',
      customerName: 'Synthetic',
      kind: 'invoice' as const,
      reference: 'SYN',
      debitMinor: 15000,
      creditMinor: 0,
    },
    {
      entryId: 'payment',
      recordedAt: '2026-10-11T02:00:00Z',
      invoiceId: id,
      invoiceNumber: '=SYN',
      customerName: 'Synthetic',
      kind: 'payment' as const,
      reference: '@cash',
      debitMinor: 0,
      creditMinor: 5000,
    },
  ],
}
function setup(code?: string) {
  const loader = vi.fn(async () => {
    if (code) throw Object.assign(new Error('Private database detail'), { code })
    return { ...report, scope: { ...report.scope, customerId: id, locationId: id } }
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
    loadWholesaleStatement: loader,
  })
  return { app, loader }
}
const headers = { authorization: 'Bearer valid', 'x-tenant-id': tenantId }
describe('wholesale statements', () => {
  it('forwards authenticated actor and validated customer/location scope', async () => {
    const { app, loader } = setup()
    const response = await app.request(
      `/v1/wholesale/statements?asOf=2026-10-11&customerId=${id}&locationId=${id}`,
      { headers },
      { ENVIRONMENT: 'test' },
    )
    expect(response.status).toBe(200)
    expect(loader).toHaveBeenCalledWith(
      userId,
      tenantId,
      { asOf: '2026-10-11', customerId: id, locationId: id },
      { ENVIRONMENT: 'test' },
    )
  })
  it.each(['', '?asOf=bad', '?asOf=2026-02-30', '?asOf=2026-10-11&tenantId=x', '?asOf=2026-10-11&customerId=x'])(
    'rejects invalid filters %s',
    async (query) => {
      const { app, loader } = setup()
      expect((await app.request(`/v1/wholesale/statements${query}`, { headers }, { ENVIRONMENT: 'test' })).status).toBe(
        400,
      )
      expect(loader).not.toHaveBeenCalled()
    },
  )
  it('does not load unauthenticated statements', async () => {
    const { app, loader } = setup()
    expect((await app.request('/v1/wholesale/statements?asOf=2026-10-11', {}, { ENVIRONMENT: 'test' })).status).toBe(
      403,
    )
    expect(loader).not.toHaveBeenCalled()
  })
  it('denies foreign tenant selection', async () => {
    const { app, loader } = setup()
    expect(
      (
        await app.request(
          '/v1/wholesale/statements?asOf=2026-10-11',
          { headers: { ...headers, 'x-tenant-id': id } },
          { ENVIRONMENT: 'test' },
        )
      ).status,
    ).toBe(403)
    expect(loader).not.toHaveBeenCalled()
  })
  it.each([
    ['HCSD0', 403],
    ['HCSD1', 400],
    ['HCSD2', 404],
  ] as const)('sanitizes %s', async (code, status) => {
    const { app } = setup(code)
    const response = await app.request('/v1/wholesale/statements?asOf=2026-10-11', { headers }, { ENVIRONMENT: 'test' })
    expect(response.status).toBe(status)
    expect(await response.text()).not.toContain('Private database detail')
  })
  it('reconciles exact partial payment and due-today balance', () =>
    expect(wholesaleStatementSchema.parse(report).summary.balanceMinor).toBe(10000))
  it('rejects inconsistent aging totals', () =>
    expect(
      wholesaleStatementSchema.safeParse({ ...report, summary: { ...report.summary, currentMinor: 1 } }).success,
    ).toBe(false))
  it('rejects inconsistent ledger totals', () =>
    expect(wholesaleStatementSchema.safeParse({ ...report, entries: [] }).success).toBe(false))
  it('rejects inconsistent invoice balances', () =>
    expect(
      wholesaleStatementSchema.safeParse({ ...report, invoices: [{ ...report.invoices[0], paidMinor: 1 }] }).success,
    ).toBe(false))
  it('rejects unsafe monetary numbers', () =>
    expect(
      wholesaleStatementSchema.safeParse({
        ...report,
        summary: { ...report.summary, balanceMinor: Number.MAX_SAFE_INTEGER + 1 },
      }).success,
    ).toBe(false))
  it('does not permit unclassified zero-debt guesses', () =>
    expect(
      wholesaleStatementSchema.safeParse({
        ...report,
        invoices: [{ ...report.invoices[0], classification: 'unclassified' }],
      }).success,
    ).toBe(false))
  it('strictly rejects client tenant query context', () =>
    expect(wholesaleStatementQuerySchema.safeParse({ asOf: '2026-10-11', tenantId }).success).toBe(false))
  it.each([
    [0, 'current', 'currentMinor'],
    [1, '1-30', 'days1To30Minor'],
    [30, '1-30', 'days1To30Minor'],
    [31, '31-60', 'days31To60Minor'],
    [60, '31-60', 'days31To60Minor'],
    [61, '61-90', 'days61To90Minor'],
    [90, '61-90', 'days61To90Minor'],
    [91, 'over-90', 'over90Minor'],
  ] as const)('validates aging boundary %s', (days, band, key) => {
    expect(
      wholesaleStatementSchema.safeParse({
        ...report,
        summary: { ...report.summary, currentMinor: 0, [key]: 10000 },
        invoices: [{ ...report.invoices[0], daysOverdue: days, band }],
      }).success,
    ).toBe(true)
    expect(
      wholesaleStatementSchema.safeParse({
        ...report,
        invoices: [{ ...report.invoices[0], daysOverdue: days, band: 'unclassified' }],
      }).success,
    ).toBe(false)
  })
  it('exports exact amounts, scope and formula-safe references', () => {
    const csv = statementCsv(wholesaleStatementSchema.parse(report))
    expect(csv).toContain('"150.00"')
    expect(csv).toContain('"50.00"')
    expect(csv).toContain('"100.00"')
    expect(csv).toContain('"Customer filter","All customers"')
    expect(csv).toContain('"\'=SYN"')
    expect(csv).toContain('"\'@cash"')
  })
})
