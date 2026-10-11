import { describe, it, expect } from 'vitest'
import { wholesaleSettlementReportSchema, type WholesaleSettlementReport } from '@hcs/contracts'
import { settlementCsv } from './wholesale-settlement'
const report: WholesaleSettlementReport = {
  scope: {
    from: '2026-10-11',
    to: '2026-10-11',
    locationId: null,
    timezone: 'Asia/Manila',
    asOf: '2026-10-11T02:00:00Z',
    generatedAt: '2026-10-11T02:00:00Z',
  },
  locations: [],
  summary: {
    issuedMinor: 450000,
    invoiceCount: 2,
    recordedReceiptsMinor: 10000,
    receiptCount: 1,
    openingChargesMinor: 0,
    closingReceivablesMinor: 440000,
    unclassifiedCount: 0,
    unclassifiedMinor: 0,
  },
  byPaymentMethod: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      name: 'Cash',
      methodType: 'cash',
      amountMinor: 10000,
      receiptCount: 1,
    },
  ],
}
describe('wholesale settlement export', () => {
  it('keeps revenue and receipt totals separate', () => {
    const csv = settlementCsv(report)
    expect(csv).toContain('"Issued invoices PHP","4500.00"')
    expect(csv).toContain('"Recorded receipts PHP","100.00"')
    expect(csv).toContain('"Closing classified balance PHP","4400.00"')
  })
  it.each(['=HYPERLINK("x")', '+cmd', '-cmd', '@cmd', '\tcmd', '\rcmd', '  =cmd'])(
    'escapes spreadsheet formula label %s',
    (name) =>
      expect(settlementCsv({ ...report, byPaymentMethod: [{ ...report.byPaymentMethod[0]!, name }] })).toContain(
        `"'${name.replaceAll('"', '""')}"`,
      ),
  )
  it('retains unknown classification warning values', () =>
    expect(
      settlementCsv({ ...report, summary: { ...report.summary, unclassifiedCount: 2, unclassifiedMinor: 20000 } }),
    ).toContain('"Unclassified invoices","2"'))
  it('rejects inconsistent payment-method totals', () =>
    expect(() =>
      wholesaleSettlementReportSchema.parse({ ...report, summary: { ...report.summary, recordedReceiptsMinor: 1 } }),
    ).toThrow())
  it('rejects unsafe financial aggregates', () =>
    expect(() =>
      wholesaleSettlementReportSchema.parse({
        ...report,
        summary: { ...report.summary, issuedMinor: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toThrow())
})
