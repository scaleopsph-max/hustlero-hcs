import { describe, expect, it } from 'vitest'

import { wholesaleReturnRequestSchema } from './wholesale-returns'

const request = {
  invoiceId: '10000000-0000-4000-8000-000000000001',
  reason: 'Customer returned unused shoes',
  lines: [{ invoiceLineId: '20000000-0000-4000-8000-000000000001', quantityMilli: 2000, returnToStock: true }],
}

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

  it.each([0, -1000, 500, 1500, Number.MAX_SAFE_INTEGER + 1])('rejects unsupported quantity %s', (quantityMilli) => {
    expect(
      wholesaleReturnRequestSchema.safeParse({ ...request, lines: [{ ...request.lines[0], quantityMilli }] }).success,
    ).toBe(false)
  })

  it('requires UUID identities and an explicit boolean disposition', () => {
    expect(wholesaleReturnRequestSchema.safeParse({ ...request, invoiceId: 'other' }).success).toBe(false)
    expect(
      wholesaleReturnRequestSchema.safeParse({ ...request, lines: [{ ...request.lines[0], returnToStock: 'true' }] })
        .success,
    ).toBe(false)
  })
})
