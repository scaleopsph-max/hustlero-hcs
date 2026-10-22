import { describe, expect, it } from 'vitest'

import { wholesaleReturnRequestSchema, wholesaleCreditNoteSchema } from './wholesale-returns'

const request = {
  invoiceId: '10000000-0000-4000-8000-000000000001',
  reason: 'Customer returned unused shoes',
  lines: [{ invoiceLineId: '20000000-0000-4000-8000-000000000001', quantityMilli: 2000, returnToStock: true }],
}

const note = {
  creditNoteId: request.invoiceId,
  invoiceId: request.invoiceId,
  refundId: request.invoiceId,
  customerId: request.invoiceId,
  locationId: request.invoiceId,
  reason: request.reason,
  amountMinor: 90000,
  debtReductionMinor: 50000,
  issuedCreditMinor: 40000,
  availableCreditMinor: 30000,
  commandKey: null,
  payoutBlocked: false,
  recordedAt: '2026-10-19T00:00:00Z',
  lines: [
    {
      invoiceLineId: request.lines[0]!.invoiceLineId,
      name: 'Original shoes / Size 9',
      quantityMilli: 2000,
      amountMinor: 90000,
      returnToStock: false,
    },
  ],
}
describe('immutable wholesale credit-note detail', () => {
  it('accepts exact original lines, disposition and reconciled debt/customer-credit split', () => {
    expect(wholesaleCreditNoteSchema.parse(note)).toEqual(note)
  })
  it.each([
    { debtReductionMinor: 50001 },
    { debtReductionMinor: 50000.5 },
    { availableCreditMinor: 40001 },
    { reason: '' },
    { refundId: 'unknown' },
    { lines: [] },
    { lines: [{ ...note.lines[0]!, quantityMilli: 1.5 }] },
    { lines: [{ ...note.lines[0]!, amountMinor: 89999 }] },
    { lines: [note.lines[0]!, note.lines[0]!] },
  ])('fails closed for inconsistent or incomplete note detail %j', (changes) => {
    expect(wholesaleCreditNoteSchema.safeParse({ ...note, ...changes }).success).toBe(false)
  })
})

describe('wholesale return request foundation', () => {
  it('accepts only invoice/line quantities, disposition and reason', () => {
    expect(wholesaleReturnRequestSchema.parse(request)).toEqual(request)
  })

  it.each(['tenantId', 'customerId', 'amountMinor', 'unitPriceMinor', 'cashPayoutMinor', 'paymentMethodId'])(
    'rejects client-controlled %s',
    (field) => {
      expect(wholesaleReturnRequestSchema.safeParse({ ...request, [field]: 1 }).success).toBe(false)
    },
  )

  it('rejects line prices, duplicate lines, empty lines and missing reason', () => {
    expect(
      wholesaleReturnRequestSchema.safeParse({ ...request, lines: [{ ...request.lines[0], amountMinor: 1 }] }).success,
    ).toBe(false)
    expect(
      wholesaleReturnRequestSchema.safeParse({ ...request, lines: [...request.lines, ...request.lines] }).success,
    ).toBe(false)
    expect(wholesaleReturnRequestSchema.safeParse({ ...request, lines: [] }).success).toBe(false)
    expect(wholesaleReturnRequestSchema.safeParse({ ...request, reason: '  ' }).success).toBe(false)
  })

  it.each([0, -1000, 0.5, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects unsupported quantity %s', (quantityMilli) => {
    expect(
      wholesaleReturnRequestSchema.safeParse({ ...request, lines: [{ ...request.lines[0], quantityMilli }] }).success,
    ).toBe(false)
  })

  it.each([1, 500, 1500])('accepts exact integer milli-quantity %s without client valuation', (quantityMilli) => {
    expect(
      wholesaleReturnRequestSchema.parse({ ...request, lines: [{ ...request.lines[0], quantityMilli }] }).lines[0]
        ?.quantityMilli,
    ).toBe(quantityMilli)
    expect(
      wholesaleCreditNoteSchema.parse({ ...note, lines: [{ ...note.lines[0], quantityMilli }] }).lines[0]
        ?.quantityMilli,
    ).toBe(quantityMilli)
  })

  it('requires UUID identities and an explicit boolean disposition', () => {
    expect(wholesaleReturnRequestSchema.safeParse({ ...request, invoiceId: 'other' }).success).toBe(false)
    expect(
      wholesaleReturnRequestSchema.safeParse({ ...request, lines: [{ ...request.lines[0], returnToStock: 'true' }] })
        .success,
    ).toBe(false)
  })
})
