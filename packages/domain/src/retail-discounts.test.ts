import { expect, it } from 'vitest'
import { quoteRetailTicketDiscount, type RetailDiscountDefinition, type RetailDiscountLine } from './retail-discounts'
const definition: RetailDiscountDefinition = {
  id: 'discount-1',
  name: 'Retail promotion',
  revision: 1,
  status: 'active',
  kind: 'fixed',
  amountMinor: 101,
}
const line = (id: string, grossMinor: number): RetailDiscountLine => ({
  id,
  grossMinor,
  taxMinor: 0,
  pricingType: 'retail',
})
const ticket = (lines: RetailDiscountLine[]) => ({
  channel: 'pos' as const,
  lines,
  existingDiscountMinor: 0,
  loyaltyRedemptionMinor: 0,
})
it('allocates a whole-ticket fixed discount exactly by original gross amounts', () => {
  const quote = quoteRetailTicketDiscount(definition, ticket([line('B', 300), line('A', 200)]))
  expect(quote).toMatchObject({
    subtotalMinor: 500,
    discountMinor: 101,
    totalMinor: 399,
    lines: [
      { id: 'A', discountMinor: 40, netMinor: 160 },
      { id: 'B', discountMinor: 61, netMinor: 239 },
    ],
  })
})
it('uses half-up cents for percentage and cumulative allocations', () => {
  const quote = quoteRetailTicketDiscount(
    { ...definition, kind: 'percent', rateBps: 5000 },
    ticket([line('C', 1), line('A', 1), line('B', 1)]),
  )
  expect(quote.discountMinor).toBe(2)
  expect(quote.totalMinor).toBe(1)
  expect(quote.lines.map((row) => row.discountMinor)).toEqual([1, 0, 1])
})
it('is invariant to input order and does not mutate original definitions or lines', () => {
  const original = structuredClone(definition),
    lines = [line('B', 300), line('A', 200)],
    before = structuredClone(lines)
  const first = quoteRetailTicketDiscount(definition, ticket(lines)),
    second = quoteRetailTicketDiscount(definition, ticket([...lines].reverse()))
  expect(first).toEqual(second)
  expect(lines).toEqual(before)
  expect(definition).toEqual(original)
  definition.name = 'Changed later'
  expect(first.definitionSnapshot.name).toBe('Retail promotion')
  definition.name = original.name
})
it('preserves exact amounts at the configured money boundary', () => {
  const quote = quoteRetailTicketDiscount({ ...definition, amountMinor: 1 }, ticket([line('A', 99_999_999_999)]))
  expect(quote.totalMinor).toBe(99_999_999_998)
})
it.each([
  { id: '' },
  { name: ' ' },
  { name: 'x'.repeat(81) },
  { revision: 0 },
  { revision: 1.5 },
  { revision: 2147483648 },
])('rejects malformed definition identity and revision: %j', (invalid) => {
  expect(() => quoteRetailTicketDiscount({ ...definition, ...invalid }, ticket([line('A', 500)]))).toThrow(
    /active versioned/,
  )
})
it('preserves the selected percentage value in the original quote snapshot', () => {
  const quote = quoteRetailTicketDiscount({ ...definition, kind: 'percent', rateBps: 1250 }, ticket([line('A', 10000)]))
  expect(quote).toMatchObject({
    discountMinor: 1250,
    totalMinor: 8750,
    definitionSnapshot: { kind: 'percent', rateBps: 1250, revision: 1, scope: 'retail_ticket' },
  })
  expect(quote.definitionSnapshot).not.toHaveProperty('amountMinor')
})
it('accepts exactly 200 eligible retail lines with exact allocation', () => {
  const quote = quoteRetailTicketDiscount(
    { ...definition, amountMinor: 100 },
    ticket(Array.from({ length: 200 }, (_, i) => line(String(i).padStart(3, '0'), 100))),
  )
  expect(quote.lines).toHaveLength(200)
  expect(quote.discountMinor).toBe(100)
  expect(quote.lines.reduce((sum, row) => sum + row.discountMinor, 0)).toBe(100)
  expect(quote.totalMinor).toBe(19900)
})
it('gives zero-value lines no allocation without inventing a free ticket', () => {
  const quote = quoteRetailTicketDiscount({ ...definition, amountMinor: 1 }, ticket([line('A', 0), line('B', 10)]))
  expect(quote.lines[0]).toEqual({ id: 'A', grossMinor: 0, discountMinor: 0, netMinor: 0 })
  expect(quote.totalMinor).toBe(9)
})
it.each(['inactive', 'archived'] as const)('rejects %s definitions', (status) =>
  expect(() => quoteRetailTicketDiscount({ ...definition, status }, ticket([line('A', 500)]))).toThrow(/active/),
)
it.each(['wholesale', 'dealer'] as const)('rejects mixed tickets containing %s lines', (pricingType) =>
  expect(() =>
    quoteRetailTicketDiscount(definition, ticket([line('A', 500), { ...line('B', 500), pricingType }])),
  ).toThrow(/retail-only/),
)
it('rejects wholesale channel even when supplied lines are retail-priced', () =>
  expect(() => quoteRetailTicketDiscount(definition, { ...ticket([line('A', 500)]), channel: 'wholesale' })).toThrow(
    /POS/,
  ))
it.each([
  { existingDiscountMinor: 1, loyaltyRedemptionMinor: 0 },
  { existingDiscountMinor: 0, loyaltyRedemptionMinor: 1 },
])('rejects stacking and loyalty redemption', (input) =>
  expect(() => quoteRetailTicketDiscount(definition, { ...ticket([line('A', 500)]), ...input })).toThrow(/stacking/),
)
it('rejects any nonzero tax snapshot without changing tax rates', () =>
  expect(() => quoteRetailTicketDiscount(definition, ticket([{ ...line('A', 500), taxMinor: 1 }]))).toThrow(/untaxed/))
it.each([0, -1, 500, 501, 0.5, Number.MAX_SAFE_INTEGER])(
  'rejects invalid, zero or excessive fixed amount %s',
  (amountMinor) =>
    expect(() => quoteRetailTicketDiscount({ ...definition, amountMinor }, ticket([line('A', 500)]))).toThrow(),
)
it.each([0, -1, 10000, 10001, 0.5])('rejects invalid percentage basis points %s', (rateBps) =>
  expect(() =>
    quoteRetailTicketDiscount({ ...definition, kind: 'percent', rateBps }, ticket([line('A', 500)])),
  ).toThrow(),
)
it('rejects an otherwise valid rate that rounds to zero or to the entire tiny ticket', () => {
  expect(() =>
    quoteRetailTicketDiscount({ ...definition, kind: 'percent', rateBps: 1 }, ticket([line('A', 1)])),
  ).toThrow(/positive payable/)
  expect(() =>
    quoteRetailTicketDiscount({ ...definition, kind: 'percent', rateBps: 9999 }, ticket([line('A', 1)])),
  ).toThrow(/positive payable/)
})
it.each([
  { lines: [], error: /one to 200/ },
  { lines: [line('A', 10), line('A', 20)], error: /distinct/ },
  { lines: [line('', 100)], error: /distinct/ },
  { lines: [line('A', 0)], error: /subtotal/ },
  { lines: [line('A', -1)], error: /integer minor/ },
  { lines: [line('A', 1.1)], error: /integer minor/ },
  { lines: Array.from({ length: 201 }, (_, i) => line(String(i), 1000)), error: /one to 200/ },
])('rejects invalid line identity, count or amounts', ({ lines, error }) =>
  expect(() => quoteRetailTicketDiscount(definition, ticket(lines))).toThrow(error),
)
it('rejects aggregate overflow even when every line fits individually', () =>
  expect(() =>
    quoteRetailTicketDiscount(definition, ticket([line('A', 99_999_999_999), line('B', 99_999_999_999)])),
  ).toThrow(/subtotal/))
it('exhaustively reconciles allocation sums, bounds and stable ordering for small cent cases', () => {
  for (let a = 0; a <= 9; a++)
    for (let b = 0; b <= 9; b++)
      for (let c = 0; c <= 9; c++) {
        const sum = a + b + c
        if (sum < 2) continue
        for (let amount = 1; amount < sum; amount++) {
          const result = quoteRetailTicketDiscount(
            { ...definition, amountMinor: amount },
            ticket([line('C', c), line('A', a), line('B', b)]),
          )
          expect(result.lines.reduce((n, row) => n + row.discountMinor, 0)).toBe(amount)
          expect(result.lines.reduce((n, row) => n + row.netMinor, 0)).toBe(sum - amount)
          expect(
            result.lines.every(
              (row) =>
                Number.isInteger(row.discountMinor) && row.discountMinor >= 0 && row.discountMinor <= row.grossMinor,
            ),
          ).toBe(true)
        }
      }
})
