import { describe, expect, it } from 'vitest'

import { quoteWholesaleReturn, wholesaleReturnSettlement, type WholesaleReturnLineSnapshot } from './wholesale-returns'

const snapshot: WholesaleReturnLineSnapshot = {
  invoiceLineId: 'line-a',
  fulfilledQuantityMilli: 10_000,
  returnedQuantityMilli: 0,
  unitPriceMinor: 45_000,
  originalTotalMinor: 450_000,
  priorCreditMinor: 0,
  discountMinor: 0,
  taxMinor: 0,
}
const selection = { invoiceLineId: 'line-a', quantityMilli: 2000, returnToStock: true }

describe('wholesale return valuation foundation', () => {
  it('uses original snapshots and keeps restock separate from valuation', () => {
    for (const returnToStock of [true, false]) {
      expect(quoteWholesaleReturn([snapshot], [{ ...selection, returnToStock }])).toEqual({
        totalCreditMinor: 90_000,
        lines: [{ ...selection, returnToStock, amountMinor: 90_000 }],
      })
    }
    expect(snapshot.returnedQuantityMilli).toBe(0)
  })

  it('sums different original line prices without repricing the order', () => {
    expect(
      quoteWholesaleReturn(
        [snapshot, { ...snapshot, invoiceLineId: 'line-b', unitPriceMinor: 50_000, originalTotalMinor: 500_000 }],
        [selection, { ...selection, invoiceLineId: 'line-b', quantityMilli: 1000 }],
      ).totalCreditMinor,
    ).toBe(140_000)
  })

  it('allows only the remaining fulfilled quantity after a previous return', () => {
    const previous = { ...snapshot, returnedQuantityMilli: 8000, priorCreditMinor: 360_000 }
    expect(quoteWholesaleReturn([previous], [selection]).totalCreditMinor).toBe(90_000)
    expect(() => quoteWholesaleReturn([previous], [{ ...selection, quantityMilli: 3000 }])).toThrow(/remaining/)
  })

  it.each([
    { originalTotalMinor: 449_999 },
    { priorCreditMinor: 1 },
    { discountMinor: 1 },
    { taxMinor: 1 },
    { fulfilledQuantityMilli: 1500 },
    { returnedQuantityMilli: 500 },
    { returnedQuantityMilli: 11_000, priorCreditMinor: 495_000 },
    { unitPriceMinor: 0, originalTotalMinor: 0 },
    { unitPriceMinor: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects unsupported or inconsistent snapshot %j', (patch) => {
    expect(() => quoteWholesaleReturn([{ ...snapshot, ...patch }], [selection])).toThrow()
  })

  it.each([0, -1000, 1, 1500, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid quantity %s',
    (quantityMilli) => {
      expect(() => quoteWholesaleReturn([snapshot], [{ ...selection, quantityMilli }])).toThrow()
    },
  )

  it('rejects missing/duplicate lines and empty/excessive selections', () => {
    expect(() => quoteWholesaleReturn([snapshot], [])).toThrow()
    expect(() => quoteWholesaleReturn([snapshot], [selection, selection])).toThrow(/Duplicate/)
    expect(() => quoteWholesaleReturn([snapshot, snapshot], [selection])).toThrow()
    expect(() => quoteWholesaleReturn([], [selection])).toThrow()
    expect(() =>
      quoteWholesaleReturn(
        [snapshot],
        Array.from({ length: 201 }, () => selection),
      ),
    ).toThrow()
  })

  it('rejects aggregate overflow without losing a centavo', () => {
    const large = {
      ...snapshot,
      fulfilledQuantityMilli: 1000,
      unitPriceMinor: Number.MAX_SAFE_INTEGER,
      originalTotalMinor: Number.MAX_SAFE_INTEGER,
    }
    expect(quoteWholesaleReturn([large], [{ ...selection, quantityMilli: 1000 }]).totalCreditMinor).toBe(
      Number.MAX_SAFE_INTEGER,
    )
    expect(() =>
      quoteWholesaleReturn(
        [large, { ...large, invoiceLineId: 'line-b' }],
        [
          { ...selection, quantityMilli: 1000 },
          { ...selection, invoiceLineId: 'line-b', quantityMilli: 1000 },
        ],
      ),
    ).toThrow(/range/)
  })
})

describe('wholesale return debt and new customer-credit entitlement', () => {
  it.each([
    [0, 360_000, 90_000, 0],
    [200_000, 160_000, 90_000, 0],
    [400_000, 0, 50_000, 40_000],
    [450_000, 0, 0, 90_000],
  ])(
    'reconciles allocated payment %s without paying cash',
    (allocatedPaymentMinor, debt, reduction, customerCredit) => {
      expect(
        wholesaleReturnSettlement({
          invoiceTotalMinor: 450_000,
          priorReturnCreditMinor: 0,
          allocatedPaymentMinor,
          newReturnCreditMinor: 90_000,
        }),
      ).toEqual({
        remainingInvoiceChargeMinor: 360_000,
        openDebtMinor: debt,
        debtReductionMinor: reduction,
        newlyIssuedCustomerCreditMinor: customerCredit,
        cashPayoutMinor: 0,
      })
    },
  )

  it('issues only incremental credit after earlier returns, not the existing entitlement again', () => {
    const result = wholesaleReturnSettlement({
      invoiceTotalMinor: 450_000,
      priorReturnCreditMinor: 90_000,
      allocatedPaymentMinor: 450_000,
      newReturnCreditMinor: 45_000,
    })
    expect(result.newlyIssuedCustomerCreditMinor).toBe(45_000)
    expect(result.remainingInvoiceChargeMinor).toBe(315_000)
    expect(result.openDebtMinor).toBe(0)
  })

  it('conserves every centavo over payment and prior-credit boundaries', () => {
    for (let invoiceTotalMinor = 1; invoiceTotalMinor <= 12; invoiceTotalMinor++) {
      for (let allocatedPaymentMinor = 0; allocatedPaymentMinor <= invoiceTotalMinor; allocatedPaymentMinor++) {
        for (let priorReturnCreditMinor = 0; priorReturnCreditMinor < invoiceTotalMinor; priorReturnCreditMinor++) {
          for (
            let newReturnCreditMinor = 1;
            newReturnCreditMinor <= invoiceTotalMinor - priorReturnCreditMinor;
            newReturnCreditMinor++
          ) {
            const result = wholesaleReturnSettlement({
              invoiceTotalMinor,
              allocatedPaymentMinor,
              priorReturnCreditMinor,
              newReturnCreditMinor,
            })
            expect(result.debtReductionMinor + result.newlyIssuedCustomerCreditMinor).toBe(newReturnCreditMinor)
            expect(result.cashPayoutMinor).toBe(0)
          }
        }
      }
    }
  })

  it.each([
    { newReturnCreditMinor: 0 },
    { newReturnCreditMinor: 450_001 },
    { priorReturnCreditMinor: 450_001 },
    { allocatedPaymentMinor: 450_001 },
    { invoiceTotalMinor: 0 },
    { newReturnCreditMinor: 0.5 },
    { allocatedPaymentMinor: -1 },
    { priorReturnCreditMinor: NaN },
    { invoiceTotalMinor: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects invalid history or new credit %j', (patch) => {
    expect(() =>
      wholesaleReturnSettlement({
        invoiceTotalMinor: 450_000,
        allocatedPaymentMinor: 0,
        priorReturnCreditMinor: 0,
        newReturnCreditMinor: 90_000,
        ...patch,
      }),
    ).toThrow()
  })
})
