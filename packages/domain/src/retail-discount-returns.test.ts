import { describe, expect, it } from 'vitest'
import { quoteRetailTicketDiscount } from './retail-discounts'
import {
  quoteRetailDiscountReturn,
  type RetailDiscountReturnSnapshot,
  type RetailDiscountReturnSelection,
} from './retail-discount-returns'

function fixture(): RetailDiscountReturnSnapshot {
  return {
    subtotalMinor: 500,
    discountMinor: 101,
    totalMinor: 399,
    refundedMinor: 0,
    lines: [
      {
        saleLineId: 'A',
        quantityMilli: 3000,
        grossMinor: 200,
        discountMinor: 40,
        netMinor: 160,
        refundedQuantityMilli: 0,
        refundedMinor: 0,
      },
      {
        saleLineId: 'B',
        quantityMilli: 1000,
        grossMinor: 300,
        discountMinor: 61,
        netMinor: 239,
        refundedQuantityMilli: 0,
        refundedMinor: 0,
      },
    ],
  }
}
const selection = (saleLineId = 'A', quantityMilli = 1000): RetailDiscountReturnSelection => ({
  saleLineId,
  quantityMilli,
  returnToStock: true,
})

function apply(snapshot: RetailDiscountReturnSnapshot, selections: RetailDiscountReturnSelection[]) {
  const result = quoteRetailDiscountReturn(snapshot, selections)
  snapshot.refundedMinor += result.amountMinor
  for (const row of result.lines) {
    const line = snapshot.lines.find((line) => line.saleLineId === row.saleLineId)!
    line.refundedQuantityMilli += row.quantityMilli
    line.refundedMinor += row.amountMinor
  }
  return result
}

it('returns original net cents, never current unit price or the original gross amount', () => {
  expect(quoteRetailDiscountReturn(fixture(), [selection()])).toMatchObject({
    amountMinor: 53,
    remainingRefundableMinor: 346,
    paymentFullyReversed: false,
  })
})
it('allocates cumulative partial returns 53/54/53 and exactly exhausts the original payment', () => {
  const snapshot = fixture()
  expect([
    apply(snapshot, [selection()]).amountMinor,
    apply(snapshot, [selection()]).amountMinor,
    apply(snapshot, [selection()]).amountMinor,
  ]).toEqual([53, 54, 53])
  expect(apply(snapshot, [selection('B')])).toMatchObject({
    amountMinor: 239,
    remainingRefundableMinor: 0,
    paymentFullyReversed: true,
  })
  expect(() => quoteRetailDiscountReturn(snapshot, [selection()])).toThrow('remaining quantity')
})
it('quotes the full original-net void valuation without mutating snapshots or selections', () => {
  const snapshot = fixture(),
    selections = [selection('B'), selection('A', 3000)]
  const before = structuredClone({ snapshot, selections })
  expect(quoteRetailDiscountReturn(snapshot, selections)).toMatchObject({
    amountMinor: 399,
    paymentFullyReversed: true,
  })
  expect({ snapshot, selections }).toEqual(before)
})
it('does not change valuation when returnToStock is false', () => {
  expect(quoteRetailDiscountReturn(fixture(), [{ ...selection(), returnToStock: false }]).amountMinor).toBe(53)
})
it('is independent of input ordering while retaining stable original allocations', () => {
  const snapshot = fixture()
  snapshot.lines = [...snapshot.lines].reverse()
  expect(quoteRetailDiscountReturn(snapshot, [selection('B'), selection('A', 3000)]).amountMinor).toBe(399)
})
it('supports original 0.001 quantities with cumulative half-up cents', () => {
  const snapshot = fixture()
  snapshot.lines[0]!.quantityMilli = 3
  expect([
    apply(snapshot, [selection('A', 1)]).amountMinor,
    apply(snapshot, [selection('A', 1)]).amountMinor,
    apply(snapshot, [selection('A', 1)]).amountMinor,
  ]).toEqual([53, 54, 53])
})
it('rejects a selected zero-cent quantity without pretending to restock or pay', () => {
  expect(() => quoteRetailDiscountReturn(fixture(), [selection('A', 1)])).toThrow('no refundable centavo')
})
it('keeps zero-net line returns blocked, including when bundled with positive lines', () => {
  const snapshot: RetailDiscountReturnSnapshot = {
    subtotalMinor: 3,
    discountMinor: 2,
    totalMinor: 1,
    refundedMinor: 0,
    lines: ['A', 'B', 'C'].map((saleLineId) => ({
      saleLineId,
      quantityMilli: 1000,
      grossMinor: 1,
      discountMinor: saleLineId === 'B' ? 0 : 1,
      netMinor: saleLineId === 'B' ? 1 : 0,
      refundedQuantityMilli: 0,
      refundedMinor: 0,
    })),
  }
  expect(() => quoteRetailDiscountReturn(snapshot, [selection('A'), selection('B')])).toThrow('no refundable centavo')
})

describe('fails closed on malformed or inconsistent original evidence', () => {
  it.each(['subtotalMinor', 'discountMinor', 'totalMinor', 'refundedMinor'] as const)(
    'rejects tampered header %s',
    (field) => {
      const snapshot = fixture()
      snapshot[field]++
      expect(() => quoteRetailDiscountReturn(snapshot, [selection()])).toThrow()
    },
  )
  it.each([
    'quantityMilli',
    'grossMinor',
    'discountMinor',
    'netMinor',
    'refundedQuantityMilli',
    'refundedMinor',
  ] as const)('rejects invalid line %s', (field) => {
    const snapshot = fixture()
    snapshot.lines[0]![field] = -1
    expect(() => quoteRetailDiscountReturn(snapshot, [selection()])).toThrow()
  })
  it.each([NaN, Infinity, -Infinity, -1, 0.1, Number.MAX_SAFE_INTEGER + 1])('rejects invalid integer %s', (value) => {
    const snapshot = fixture()
    snapshot.lines[0]!.netMinor = value
    expect(() => quoteRetailDiscountReturn(snapshot, [selection()])).toThrow()
    expect(() => quoteRetailDiscountReturn(fixture(), [selection('A', value)])).toThrow()
  })
  it('rejects missing and duplicate original lines even if the selection is unaffected', () => {
    const snapshot = fixture()
    snapshot.lines = [snapshot.lines[0]!]
    expect(() => quoteRetailDiscountReturn(snapshot, [selection()])).toThrow()
    snapshot.lines = [snapshot.lines[0]!, snapshot.lines[0]!]
    expect(() => quoteRetailDiscountReturn(snapshot, [selection()])).toThrow()
  })
  it('rejects shifted discount allocations even when header totals still reconcile', () => {
    const snapshot = fixture()
    snapshot.lines[0]!.discountMinor++
    snapshot.lines[0]!.netMinor--
    snapshot.lines[1]!.discountMinor--
    snapshot.lines[1]!.netMinor++
    expect(() => quoteRetailDiscountReturn(snapshot, [selection()])).toThrow('allocation')
  })
  it('rejects incoherent cumulative history and inconsistent sale-wide refund totals', () => {
    const snapshot = fixture()
    snapshot.lines[0]!.refundedQuantityMilli = 1000
    snapshot.lines[0]!.refundedMinor = 52
    snapshot.refundedMinor = 52
    expect(() => quoteRetailDiscountReturn(snapshot, [selection()])).toThrow('history')
    snapshot.lines[0]!.refundedMinor = 53
    expect(() => quoteRetailDiscountReturn(snapshot, [selection()])).toThrow('sale totals')
  })
  it('rejects gross-price legacy refund history on a discounted sale', () => {
    const snapshot = fixture()
    snapshot.lines[0]!.refundedQuantityMilli = 1000
    snapshot.lines[0]!.refundedMinor = 67
    snapshot.refundedMinor = 67
    expect(() => quoteRetailDiscountReturn(snapshot, [selection()])).toThrow('history')
  })
  it('rejects foreign, duplicate, empty and oversized selections', () => {
    for (const selections of [
      [],
      [selection('foreign')],
      [selection(), selection()],
      Array.from({ length: 201 }, () => selection()),
    ])
      expect(() => quoteRetailDiscountReturn(fixture(), selections)).toThrow()
  })
  it('rejects zero/excess quantities and nonboolean stock instructions', () => {
    for (const value of [0, 3001]) expect(() => quoteRetailDiscountReturn(fixture(), [selection('A', value)])).toThrow()
    expect(() =>
      quoteRetailDiscountReturn(fixture(), [{ ...selection(), returnToStock: 'true' as unknown as boolean }]),
    ).toThrow()
  })
  it('rejects an overreturned original line before quoting any new refund', () => {
    const snapshot = fixture()
    snapshot.lines[1]!.refundedQuantityMilli = 1001
    expect(() => quoteRetailDiscountReturn(snapshot, [selection()])).toThrow()
  })
})

it('reconciles exhaustive small-price ticket splits against the original discount quote', () => {
  // Independent integer-cents oracle: 3 equal return batches must sum to original net.
  for (let gross = 6; gross <= 60; gross++)
    for (let discount = 1; discount < gross - 2; discount++) {
      const quoted = quoteRetailTicketDiscount(
        { id: 'historic', revision: 1, name: 'Original', status: 'active', kind: 'fixed', amountMinor: discount },
        {
          channel: 'pos',
          existingDiscountMinor: 0,
          loyaltyRedemptionMinor: 0,
          lines: [{ id: 'A', grossMinor: gross, taxMinor: 0, pricingType: 'retail' }],
        },
      )
      const line = quoted.lines[0]!
      const snapshot: RetailDiscountReturnSnapshot = {
        subtotalMinor: gross,
        discountMinor: discount,
        totalMinor: gross - discount,
        refundedMinor: 0,
        lines: [
          {
            saleLineId: line.id,
            quantityMilli: 3,
            grossMinor: line.grossMinor,
            discountMinor: line.discountMinor,
            netMinor: line.netMinor,
            refundedQuantityMilli: 0,
            refundedMinor: 0,
          },
        ],
      }
      const results = [
        apply(snapshot, [selection('A', 1)]),
        apply(snapshot, [selection('A', 1)]),
        apply(snapshot, [selection('A', 1)]),
      ]
      expect(results.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(gross - discount)
      expect(results[2]!.remainingRefundableMinor).toBe(0)
    }
})
it('uses BigInt intermediates near the retail ceiling without multiplication precision loss', () => {
  const gross = 99_999_999_999,
    discount = 1,
    net = gross - discount
  const snapshot: RetailDiscountReturnSnapshot = {
    subtotalMinor: gross,
    discountMinor: discount,
    totalMinor: net,
    refundedMinor: 0,
    lines: [
      {
        saleLineId: 'A',
        quantityMilli: Number.MAX_SAFE_INTEGER,
        grossMinor: gross,
        discountMinor: discount,
        netMinor: net,
        refundedQuantityMilli: 0,
        refundedMinor: 0,
      },
    ],
  }
  expect(quoteRetailDiscountReturn(snapshot, [selection('A', Number.MAX_SAFE_INTEGER)])).toMatchObject({
    amountMinor: net,
    remainingRefundableMinor: 0,
  })
})

it('distinguishes exhausted payment from physical quantities still remaining after cent rounding', () => {
  const snapshot: RetailDiscountReturnSnapshot = {
    subtotalMinor: 2,
    discountMinor: 1,
    totalMinor: 1,
    refundedMinor: 0,
    lines: [
      {
        saleLineId: 'A',
        quantityMilli: 3,
        grossMinor: 2,
        discountMinor: 1,
        netMinor: 1,
        refundedQuantityMilli: 0,
        refundedMinor: 0,
      },
    ],
  }
  expect(quoteRetailDiscountReturn(snapshot, [selection('A', 2)])).toMatchObject({
    amountMinor: 1,
    paymentFullyReversed: true,
    hasUnreturnedQuantity: true,
  })
  expect(quoteRetailDiscountReturn(snapshot, [selection('A', 3)])).toMatchObject({
    amountMinor: 1,
    paymentFullyReversed: true,
    hasUnreturnedQuantity: false,
  })
})
