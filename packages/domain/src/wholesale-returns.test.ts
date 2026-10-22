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
    { fulfilledQuantityMilli: 1500 },
    { returnedQuantityMilli: 500 },
    { returnedQuantityMilli: 11_000, priorCreditMinor: 495_000 },
    { unitPriceMinor: 0, originalTotalMinor: 0 },
    { unitPriceMinor: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects unsupported or inconsistent snapshot %j', (patch) => {
    expect(() => quoteWholesaleReturn([{ ...snapshot, ...patch }], [selection])).toThrow()
  })

  it.each([0, -1000, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid quantity %s',
    (quantityMilli) => {
      expect(() => quoteWholesaleReturn([snapshot], [{ ...selection, quantityMilli }])).toThrow()
    },
  )

  it('uses original discounted/taxed amounts with milli-unit quantities and exact final remainder', () => {
    const original = {
      ...snapshot,
      fulfilledQuantityMilli: 3000,
      unitPriceMinor: 101,
      originalTotalMinor: 303,
      discountMinor: 10,
      taxMinor: 35,
    }
    let returnedQuantityMilli = 0,
      priorCreditMinor = 0
    const amounts: number[] = []
    for (const quantityMilli of [333, 667, 1000, 1000]) {
      const quote = quoteWholesaleReturn(
        [{ ...original, returnedQuantityMilli, priorCreditMinor }],
        [{ ...selection, quantityMilli }],
      )
      amounts.push(quote.totalCreditMinor)
      returnedQuantityMilli += quantityMilli
      priorCreditMinor += quote.totalCreditMinor
    }
    expect(amounts).toEqual([36, 73, 110, 109])
    expect(priorCreditMinor).toBe(328)
  })
  it('conserves cumulative cents across positive fractional return partitions', () => {
    for (let amount = 2; amount < 32; amount++) {
      const original = {
        ...snapshot,
        fulfilledQuantityMilli: 2000,
        unitPriceMinor: amount,
        originalTotalMinor: amount * 2,
        discountMinor: 1,
        taxMinor: 1,
      }
      const first = quoteWholesaleReturn([original], [{ ...selection, quantityMilli: 500 }]).totalCreditMinor
      const last = quoteWholesaleReturn(
        [{ ...original, returnedQuantityMilli: 500, priorCreditMinor: first }],
        [{ ...selection, quantityMilli: 1500 }],
      ).totalCreditMinor
      expect(first + last).toBe(amount * 2)
    }
  })
  it('rejects zero-cent slices, excessive discounts and inconsistent cumulative history', () => {
    const tiny = { ...snapshot, fulfilledQuantityMilli: 1000, unitPriceMinor: 1, originalTotalMinor: 1 }
    expect(() => quoteWholesaleReturn([tiny], [{ ...selection, quantityMilli: 1 }])).toThrow(/centavo/)
    expect(() => quoteWholesaleReturn([{ ...snapshot, discountMinor: 450001 }], [selection])).toThrow(/Discount/)
    expect(() =>
      quoteWholesaleReturn([{ ...snapshot, returnedQuantityMilli: 1, priorCreditMinor: 1 }], [selection]),
    ).toThrow(/reconcile/)
  })

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
