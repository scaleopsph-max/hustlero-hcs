import { describe, expect, it } from 'vitest'

import {
  assertWholesaleFulfillmentPayment,
  validateWholesalePaymentAllocation,
  wholesaleCreditExposure,
  wholesaleInvoiceDueDate,
  wholesaleReceivableAging,
} from './wholesale-receivables'

describe('wholesale invoice due dates', () => {
  it.each([
    ['prepaid', '2026-10-11'],
    ['cod', '2026-10-11'],
    ['net_7', '2026-10-18'],
    ['net_15', '2026-10-26'],
    ['net_30', '2026-11-10'],
  ] as const)('calculates %s using the branch business day', (term, expected) => {
    expect(wholesaleInvoiceDueDate('2026-10-10T16:30:00Z', 'Asia/Manila', term)).toBe(expected)
  })

  it('uses calendar days across DST and a leap year', () => {
    expect(wholesaleInvoiceDueDate('2026-03-07T17:00:00Z', 'America/New_York', 'net_7')).toBe('2026-03-14')
    expect(wholesaleInvoiceDueDate('2028-02-28T12:00:00Z', 'Asia/Manila', 'net_7')).toBe('2028-03-06')
  })

  it.each(['2026-10-10T12:00:00', '2026-02-30T12:00:00Z', '2026-10-10T24:00:00Z', 'bad'])(
    'rejects invalid timestamp %s',
    (timestamp) => {
      expect(() => wholesaleInvoiceDueDate(timestamp, 'Asia/Manila', 'cod')).toThrow()
    },
  )

  it('fails closed for invalid timezone or runtime term', () => {
    expect(() => wholesaleInvoiceDueDate('2026-10-10T12:00:00Z', 'invalid', 'cod')).toThrow()
    expect(() => wholesaleInvoiceDueDate('2026-10-10T12:00:00Z', 'Asia/Manila', '__proto__' as 'cod')).toThrow()
  })
})

describe('receivable aging', () => {
  it.each([
    ['2026-09-30', 'current'],
    ['2026-10-01', 'current'],
    ['2026-10-02', '1_30'],
    ['2026-10-31', '1_30'],
    ['2026-11-01', '31_60'],
    ['2026-11-30', '31_60'],
    ['2026-12-01', '61_90'],
    ['2026-12-30', '61_90'],
    ['2026-12-31', 'over_90'],
  ])('ages at %s into %s', (asOf, expected) => {
    expect(wholesaleReceivableAging('2026-10-01', asOf)).toBe(expected)
  })

  it('rejects impossible calendar dates', () => {
    expect(() => wholesaleReceivableAging('2026-02-30', '2026-10-10')).toThrow()
    expect(() => wholesaleReceivableAging('2026-10-10', '10/10/2026')).toThrow()
  })
})

describe('credit exposure', () => {
  it('treats zero limit as no credit', () => {
    expect(
      wholesaleCreditExposure({ creditLimitMinor: 0, openReceivablesMinor: 1, confirmedUnfulfilledMinor: 0 }),
    ).toEqual({ exposureMinor: 1, availableCreditMinor: -1, exceedsLimit: true })
  })

  it('counts both open receivables and unfulfilled commitments', () => {
    expect(
      wholesaleCreditExposure({
        creditLimitMinor: 500000,
        openReceivablesMinor: 225000,
        confirmedUnfulfilledMinor: 225000,
      }),
    ).toEqual({ exposureMinor: 450000, availableCreditMinor: 50000, exceedsLimit: false })
  })

  it('keeps exposure stable when commitment turns into invoice debt', () => {
    const before = wholesaleCreditExposure({
      creditLimitMinor: 450000,
      openReceivablesMinor: 0,
      confirmedUnfulfilledMinor: 450000,
    })
    const after = wholesaleCreditExposure({
      creditLimitMinor: 450000,
      openReceivablesMinor: 225000,
      confirmedUnfulfilledMinor: 225000,
    })
    expect(after).toEqual(before)
    expect(after.exceedsLimit).toBe(false)
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid money %s',
    (value) => {
      expect(() =>
        wholesaleCreditExposure({ creditLimitMinor: value, openReceivablesMinor: 0, confirmedUnfulfilledMinor: 0 }),
      ).toThrow()
    },
  )

  it('rejects overflowing aggregate exposure', () => {
    expect(() =>
      wholesaleCreditExposure({
        creditLimitMinor: 0,
        openReceivablesMinor: Number.MAX_SAFE_INTEGER,
        confirmedUnfulfilledMinor: 1,
      }),
    ).toThrow()
  })
})

describe('payment allocations', () => {
  const first = { invoiceId: 'first', amountMinor: 225000, openBalanceMinor: 225000 }
  const second = { invoiceId: 'second', amountMinor: 225000, openBalanceMinor: 225000 }

  it('accepts exact settlement of the two opening invoices', () => {
    expect(() => validateWholesalePaymentAllocation(450000, [first, second])).not.toThrow()
  })

  it('accepts a partial invoice payment', () => {
    expect(() => validateWholesalePaymentAllocation(100000, [{ ...first, amountMinor: 100000 }])).not.toThrow()
  })

  it('rejects duplicate invoices', () => {
    expect(() => validateWholesalePaymentAllocation(450000, [first, first])).toThrow()
  })

  it('rejects allocation against a settled or insufficient balance', () => {
    expect(() => validateWholesalePaymentAllocation(225000, [{ ...first, openBalanceMinor: 0 }])).toThrow()
    expect(() => validateWholesalePaymentAllocation(225000, [{ ...first, openBalanceMinor: 224999 }])).toThrow()
  })

  it('rejects unallocated overpayment and mismatched totals', () => {
    expect(() => validateWholesalePaymentAllocation(450001, [first, second])).toThrow()
    expect(() => validateWholesalePaymentAllocation(449999, [first, second])).toThrow()
  })

  it('rejects zero payment and missing allocations', () => {
    expect(() => validateWholesalePaymentAllocation(0, [])).toThrow()
    expect(() => validateWholesalePaymentAllocation(1, [])).toThrow()
    expect(() => validateWholesalePaymentAllocation(1, [{ ...first, amountMinor: 0 }])).toThrow()
  })
})

describe('payment at fulfillment', () => {
  it.each(['prepaid', 'cod'] as const)('requires full payment for %s', (term) => {
    expect(() => assertWholesaleFulfillmentPayment(term, 225000, 225000)).not.toThrow()
    expect(() => assertWholesaleFulfillmentPayment(term, 225000, 0)).toThrow()
    expect(() => assertWholesaleFulfillmentPayment(term, 225000, 224999)).toThrow()
  })

  it.each(['net_7', 'net_15', 'net_30'] as const)('allows unpaid or partial %s invoice', (term) => {
    expect(() => assertWholesaleFulfillmentPayment(term, 225000, 0)).not.toThrow()
    expect(() => assertWholesaleFulfillmentPayment(term, 225000, 100000)).not.toThrow()
    expect(() => assertWholesaleFulfillmentPayment(term, 225000, 225001)).toThrow()
  })
})
