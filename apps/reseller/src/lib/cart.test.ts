import type { ResellerCatalogItem } from '@hcs/contracts'
import { describe, expect, it } from 'vitest'

import { formatQuantity, lineAmountMinor, quantityInCart, setCartQuantity, summarizeCart } from './cart'

const item = (overrides: Partial<ResellerCatalogItem>): ResellerCatalogItem => ({
  variantId: '50000000-0000-4000-8000-000000000001',
  productId: '51000000-0000-4000-8000-000000000001',
  productName: 'Coffee Beans',
  variantName: '250g',
  sku: 'COF-250',
  categoryName: null,
  unitPriceMinor: 25_000,
  srpMinor: 35_000,
  pricingGroupId: '52000000-0000-4000-8000-000000000001',
  pricingGroupName: 'Coffee',
  thresholdMilli: 6_000,
  stockStatus: 'in_stock',
  ...overrides,
})

const small = item({})
const large = item({
  variantId: '50000000-0000-4000-8000-000000000002',
  variantName: '1kg',
  sku: 'COF-1K',
  unitPriceMinor: 90_000,
  srpMinor: 120_000,
  stockStatus: 'out_of_stock',
})
const tea = item({
  variantId: '50000000-0000-4000-8000-000000000003',
  productName: 'Tea',
  variantName: 'Box',
  sku: 'TEA-1',
  unitPriceMinor: 12_345,
  srpMinor: 15_000,
  pricingGroupId: '52000000-0000-4000-8000-000000000002',
  pricingGroupName: 'Tea',
  thresholdMilli: 1_000,
})

describe('reseller cart', () => {
  it('rounds line amounts like the database, half away from zero', () => {
    expect(lineAmountMinor(25_000, 10_000)).toBe(250_000)
    expect(lineAmountMinor(12_345, 1_500)).toBe(18_518) // 185.175 -> 185.18
    expect(lineAmountMinor(1, 500)).toBe(1)
    expect(lineAmountMinor(1, 499)).toBe(0)
    expect(lineAmountMinor(99_999_999, 999_999)).toBe(99_999_899_000)
  })

  it('totals the cart and estimates reseller profit from SRP', () => {
    const summary = summarizeCart(
      [
        { variantId: small.variantId, quantityMilli: 4_000 },
        { variantId: large.variantId, quantityMilli: 2_000 },
        { variantId: tea.variantId, quantityMilli: 1_500 },
      ],
      [small, large, tea],
    )
    expect(summary.totalMinor).toBe(100_000 + 180_000 + 18_518)
    expect(summary.potentialProfitMinor).toBe(40_000 + 60_000 + (22_500 - 18_518))
    expect(summary.hasOutOfStock).toBe(true)
    expect(summary.itemCount).toBe(3)
  })

  it('reports how many more units each wholesale group needs', () => {
    const summary = summarizeCart(
      [
        { variantId: small.variantId, quantityMilli: 2_000 },
        { variantId: large.variantId, quantityMilli: 1_000 },
        { variantId: tea.variantId, quantityMilli: 1_000 },
      ],
      [small, large, tea],
    )
    expect(summary.shortfalls).toEqual([
      { pricingGroupId: small.pricingGroupId, pricingGroupName: 'Coffee', neededMilli: 3_000 },
    ])
  })

  it('flags items that left the catalog instead of pricing them', () => {
    const summary = summarizeCart([{ variantId: 'gone', quantityMilli: 1_000 }], [small])
    expect(summary.missingVariantIds).toEqual(['gone'])
    expect(summary.rows).toHaveLength(0)
    expect(summary.totalMinor).toBe(0)
  })

  it('sets, keeps order of, and removes cart lines', () => {
    let lines = setCartQuantity([], 'a', 1_000)
    lines = setCartQuantity(lines, 'b', 2_000)
    lines = setCartQuantity(lines, 'a', 5_000)
    expect(lines).toEqual([
      { variantId: 'a', quantityMilli: 5_000 },
      { variantId: 'b', quantityMilli: 2_000 },
    ])
    expect(quantityInCart(lines, 'b')).toBe(2_000)
    expect(setCartQuantity(lines, 'a', 0)).toEqual([{ variantId: 'b', quantityMilli: 2_000 }])
    expect(setCartQuantity(lines, 'b', Number.NaN)).toEqual([{ variantId: 'a', quantityMilli: 5_000 }])
  })

  it('formats quantities as whole units when possible', () => {
    expect(formatQuantity(12_000)).toBe('12')
    expect(formatQuantity(1_500)).toBe('1.5')
  })
})
