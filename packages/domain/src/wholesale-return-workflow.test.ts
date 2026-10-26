import { describe, expect, it } from 'vitest'

import { quoteWholesaleReturn, wholesaleReturnSettlement, type WholesaleReturnLineSnapshot } from './wholesale-returns'

// Quotient/remainder oracle, independent of the implementation's rounding formula.
function roundedShare(amount: number, quantity: number, denominator: number): number {
  const numerator = BigInt(amount) * BigInt(quantity)
  const divisor = BigInt(denominator)
  return Number(numerator / divisor + ((numerator % divisor) * 2n >= divisor ? 1n : 0n))
}

function original(quantity: number, price: number, discount = 0, tax = 0): WholesaleReturnLineSnapshot {
  return {
    invoiceLineId: 'original-line',
    fulfilledQuantityMilli: quantity,
    returnedQuantityMilli: 0,
    unitPriceMinor: price,
    originalTotalMinor: roundedShare(price, quantity, 1000),
    priorCreditMinor: 0,
    discountMinor: discount,
    taxMinor: tax,
  }
}

function quote(line: WholesaleReturnLineSnapshot, quantityMilli: number, returnToStock = true) {
  return quoteWholesaleReturn([line], [{ invoiceLineId: line.invoiceLineId, quantityMilli, returnToStock }])
}

describe('wholesale return computation sequences (local domain only)', () => {
  it('conserves original payable across fractional histories without accepting zero-cent slices', () => {
    let histories = 0
    let deniedSlices = 0
    for (const quantity of [333, 1000, 3000]) {
      for (const price of [7, 101, 45_000]) {
        const base = original(quantity, price)
        for (const discount of [0, Number(BigInt(base.originalTotalMinor) / 3n), base.originalTotalMinor]) {
          for (const tax of [0, 1, 19]) {
            const payable = base.originalTotalMinor - discount + tax
            if (payable === 0) continue
            let line = { ...base, discountMinor: discount, taxMinor: tax }
            const cuts = [
              ...new Set([1, Math.floor(quantity / 3), Math.floor((quantity * 2) / 3), quantity - 1, quantity]),
            ]
            for (const cut of cuts) {
              const quantityMilli = cut - line.returnedQuantityMilli
              const expectedCumulative = roundedShare(payable, cut, quantity)
              const expectedDelta = expectedCumulative - line.priorCreditMinor
              const frozen = Object.freeze({ ...line })
              if (expectedDelta === 0) {
                expect(() => quote(frozen, quantityMilli)).toThrow(/centavo/)
                deniedSlices++
              } else {
                const result = quote(frozen, quantityMilli, cut % 2 === 0)
                expect(result.totalCreditMinor).toBe(expectedDelta)
                expect(result.lines).toHaveLength(1)
                expect(result.lines[0]?.amountMinor).toBe(expectedDelta)
                line = { ...line, returnedQuantityMilli: cut, priorCreditMinor: expectedCumulative }
              }
              expect(frozen.priorCreditMinor).toBe(expectedCumulative - expectedDelta)
            }
            expect(line.priorCreditMinor).toBe(payable)
            expect(line.returnedQuantityMilli).toBeLessThanOrEqual(quantity)
            // A zero-cent tail remains rejected, not silently restocked or rounded up.
            if (line.returnedQuantityMilli < quantity) {
              expect(() => quote(line, quantity - line.returnedQuantityMilli)).toThrow(/centavo/)
            }
            histories++
          }
        }
      }
    }
    expect(histories).toBe(72)
    expect(deniedSlices).toBeGreaterThan(0)
  })

  it('reconciles sequential credits to one full return at every payment boundary', () => {
    let histories = 0
    for (const invoiceTotalMinor of [3, 7, 101, 32_801]) {
      for (const allocatedPaymentMinor of [
        0,
        1,
        Math.floor(invoiceTotalMinor / 2),
        invoiceTotalMinor - 1,
        invoiceTotalMinor,
      ]) {
        for (let first = 1; first < Math.min(invoiceTotalMinor, 12); first++) {
          let priorReturnCreditMinor = 0
          let reductions = 0
          let issuedCredit = 0
          for (const newReturnCreditMinor of [first, invoiceTotalMinor - first]) {
            const result = wholesaleReturnSettlement({
              invoiceTotalMinor,
              allocatedPaymentMinor,
              priorReturnCreditMinor,
              newReturnCreditMinor,
            })
            expect(result.debtReductionMinor + result.newlyIssuedCustomerCreditMinor).toBe(newReturnCreditMinor)
            expect(result.cashPayoutMinor).toBe(0)
            reductions += result.debtReductionMinor
            issuedCredit += result.newlyIssuedCustomerCreditMinor
            priorReturnCreditMinor += newReturnCreditMinor
          }
          const whole = wholesaleReturnSettlement({
            invoiceTotalMinor,
            allocatedPaymentMinor,
            priorReturnCreditMinor: 0,
            newReturnCreditMinor: invoiceTotalMinor,
          })
          expect(reductions).toBe(whole.debtReductionMinor)
          expect(issuedCredit).toBe(whole.newlyIssuedCustomerCreditMinor)
          expect(reductions).toBe(invoiceTotalMinor - allocatedPaymentMinor)
          expect(issuedCredit).toBe(allocatedPaymentMinor)
          histories++
        }
      }
    }
    expect(histories).toBe(150)
  })

  it('separates collections between returns from newly issued customer credit', () => {
    let line = original(1000, 10_000)
    let payments = 0
    let totalDebtReduction = 0
    let totalIssuedCredit = 0
    const results = []
    for (const [quantity, collection] of [
      [300, 0],
      [400, 2000],
      [300, 1000],
    ] as const) {
      payments += collection
      const amount = quote(line, quantity).totalCreditMinor
      const result = wholesaleReturnSettlement({
        invoiceTotalMinor: 10_000,
        priorReturnCreditMinor: line.priorCreditMinor,
        allocatedPaymentMinor: payments,
        newReturnCreditMinor: amount,
      })
      results.push([result.openDebtMinor, result.debtReductionMinor, result.newlyIssuedCustomerCreditMinor])
      totalDebtReduction += result.debtReductionMinor
      totalIssuedCredit += result.newlyIssuedCustomerCreditMinor
      line = {
        ...line,
        returnedQuantityMilli: line.returnedQuantityMilli + quantity,
        priorCreditMinor: line.priorCreditMinor + amount,
      }
    }
    expect(results).toEqual([
      [7000, 3000, 0],
      [1000, 4000, 0],
      [0, 0, 3000],
    ])
    expect(totalDebtReduction + payments).toBe(10_000)
    expect(totalIssuedCredit).toBe(payments)
    expect(line.returnedQuantityMilli).toBe(1000)
  })

  it('does not reissue consumed entitlement or mutate original snapshots during preview', () => {
    const line = Object.freeze({ ...original(1000, 10_000), returnedQuantityMilli: 300, priorCreditMinor: 3000 })
    const selected = Object.freeze({ invoiceLineId: line.invoiceLineId, quantityMilli: 200, returnToStock: false })
    const snapshots = Object.freeze([line])
    const selections = Object.freeze([selected])
    const result = quoteWholesaleReturn(snapshots, selections)
    const settlement = wholesaleReturnSettlement({
      invoiceTotalMinor: 10_000,
      allocatedPaymentMinor: 10_000,
      priorReturnCreditMinor: 3000,
      newReturnCreditMinor: result.totalCreditMinor,
    })
    // Existing credit can already be applied/paid out; only this return's increment is issued.
    expect(settlement.newlyIssuedCustomerCreditMinor).toBe(2000)
    expect(settlement.cashPayoutMinor).toBe(0)
    expect(line.priorCreditMinor).toBe(3000)
    expect(line.returnedQuantityMilli).toBe(300)
    expect(selected.returnToStock).toBe(false)
    expect(quoteWholesaleReturn(snapshots, selections)).toEqual(result)
  })

  it('preserves exact cents for very large original amounts and rejects stale histories', () => {
    const base = original(1000, Number.MAX_SAFE_INTEGER, 17, 11)
    const payable = Number.MAX_SAFE_INTEGER - 6
    const first = quote(base, 333).totalCreditMinor
    expect(first).toBe(roundedShare(payable, 333, 1000))
    const previous = { ...base, returnedQuantityMilli: 333, priorCreditMinor: first }
    const rest = quote(previous, 667).totalCreditMinor
    expect(BigInt(first) + BigInt(rest)).toBe(BigInt(payable))
    for (const priorCreditMinor of [first - 1, first + 1]) {
      expect(() => quote({ ...previous, priorCreditMinor }, 667)).toThrow(/reconcile/)
    }
    const settled = wholesaleReturnSettlement({
      invoiceTotalMinor: payable,
      allocatedPaymentMinor: payable - 1,
      priorReturnCreditMinor: first,
      newReturnCreditMinor: rest,
    })
    expect(BigInt(settled.debtReductionMinor) + BigInt(settled.newlyIssuedCustomerCreditMinor)).toBe(BigInt(rest))
    expect(settled.openDebtMinor).toBe(0)
  })

  it('sums independent line valuations regardless of selection order or stock disposition', () => {
    const a = Object.freeze({ ...original(3000, 101, 10, 35), invoiceLineId: 'a' })
    const b = Object.freeze({ ...original(2000, 450, 11, 29), invoiceLineId: 'b' })
    const selections = [
      { invoiceLineId: 'a', quantityMilli: 667, returnToStock: true },
      { invoiceLineId: 'b', quantityMilli: 333, returnToStock: false },
    ]
    const forward = quoteWholesaleReturn([a, b], selections)
    const backward = quoteWholesaleReturn([b, a], [...selections].reverse())
    expect(forward.totalCreditMinor).toBe(quote(a, 667).totalCreditMinor + quote(b, 333).totalCreditMinor)
    expect(backward.totalCreditMinor).toBe(forward.totalCreditMinor)
    expect(backward.lines).toEqual([...forward.lines].reverse())
  })
})
