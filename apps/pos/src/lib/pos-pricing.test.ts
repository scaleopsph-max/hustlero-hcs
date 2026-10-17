import { describe, expect, it } from 'vitest'
import { resolvePosPricing } from './pos-pricing'

const customer = {
  id: '10000000-0000-4000-8000-000000000001',
  customerNumber: 'CUST-1',
  fullName: 'Dealer',
  email: null,
  phone: '1',
  customerType: 'reseller' as const,
  loyaltyEnabled: false,
  loyaltyBalancePoints: 0,
}
const option = {
  pricingType: 'wholesale' as const,
  priceListId: '20000000-0000-4000-8000-000000000001',
  priceListName: 'Wholesale',
  pricingGroupId: '30000000-0000-4000-8000-000000000001',
  pricingGroupName: 'Shirts',
  thresholdMilli: 6000,
  unitPriceCentavos: 75000,
  isDefault: true,
  customerIds: [],
}
const variantId = '40000000-0000-4000-8000-000000000001'
const items = [
  {
    variantId,
    productName: 'Shirt',
    variantName: 'XL',
    sku: 'S-XL',
    barcode: null,
    category: null,
    retailPriceCentavos: 99900,
    pricingOptions: [option],
    availableMilli: 10000,
    trackInventory: true,
  },
]

describe('POS pricing resolver', () => {
  it('keeps retail pricing independent from customer type', () => {
    expect(resolvePosPricing(items, [{ variantId, quantityMilli: 1000 }], null, 'retail').totalCentavos).toBe(99900)
  })
  it('requires a reseller and the complete pricing-group threshold', () => {
    expect(resolvePosPricing(items, [{ variantId, quantityMilli: 6000 }], null, 'wholesale').eligible).toBe(false)
    expect(resolvePosPricing(items, [{ variantId, quantityMilli: 5000 }], customer, 'wholesale').eligible).toBe(false)
    const resolved = resolvePosPricing(items, [{ variantId, quantityMilli: 6000 }], customer, 'wholesale')
    expect(resolved.eligible).toBe(true)
    expect(resolved.totalCentavos).toBe(450000)
  })
})

const categoryId = '50000000-0000-4000-8000-000000000001'
const otherCategory = '50000000-0000-4000-8000-000000000002'
const autoOption = { ...option, categoryId, thresholdMilli: 10000 }
const categoryItems = [
  { ...items[0]!, categoryId, pricingOptions: [autoOption] },
  { ...items[0]!, variantId: 'size-2', categoryId, pricingOptions: [{ ...autoOption, unitPriceCentavos: 65000 }] },
  {
    ...items[0]!,
    variantId: 'unpriced',
    productName: 'Other shoe',
    categoryId,
    pricingOptions: [],
    retailPriceCentavos: 100000,
  },
  {
    ...items[0]!,
    variantId: 'socks',
    categoryId: otherCategory,
    pricingOptions: [autoOption],
    retailPriceCentavos: 10000,
  },
]

describe('automatic category pricing', () => {
  it('combines different sizes/products of one category and uses each configured price', () => {
    const result = resolvePosPricing(
      categoryItems,
      [
        { variantId, quantityMilli: 4000 },
        { variantId: 'size-2', quantityMilli: 6000 },
      ],
      customer,
      'auto',
    )
    expect(result.eligible).toBe(true)
    expect(result.totalCentavos).toBe(690000)
    expect(result.lines.get('size-2')?.unitPriceCentavos).toBe(65000)
  })
  it('counts unpriced same-category units but keeps their retail price', () => {
    const result = resolvePosPricing(
      categoryItems,
      [
        { variantId, quantityMilli: 9000 },
        { variantId: 'unpriced', quantityMilli: 1000 },
      ],
      customer,
      'auto',
    )
    expect(result.totalCentavos).toBe(775000)
    expect(result.lines.get('unpriced')).toMatchObject({ unitPriceCentavos: 100000, pricingGroupName: null })
  })
  it('never counts another category or applies a mismatched category entry', () => {
    const result = resolvePosPricing(
      categoryItems,
      [
        { variantId, quantityMilli: 9000 },
        { variantId: 'socks', quantityMilli: 1000 },
      ],
      null,
      'auto',
    )
    expect(result.eligible).toBe(true)
    expect(result.totalCentavos).toBe(909100)
    expect(result.priceListId).toBeNull()
  })
  it('reprices immediately to retail when units drop below minimum', () => {
    const result = resolvePosPricing(categoryItems, [{ variantId, quantityMilli: 9000 }], customer, 'auto')
    expect(result.totalCentavos).toBe(899100)
    expect(result.priceListId).toBeNull()
  })
  it.each([null, { ...customer, customerType: 'standard' as const }])(
    'requires an eligible reseller only when wholesale qualifies',
    (buyer) => {
      expect(resolvePosPricing(categoryItems, [{ variantId, quantityMilli: 10000 }], buyer, 'auto').eligible).toBe(
        false,
      )
      expect(resolvePosPricing(categoryItems, [{ variantId, quantityMilli: 1000 }], buyer, 'auto').eligible).toBe(true)
    },
  )
  it('does not automatically choose dealer and preserves explicit retail', () => {
    const result = resolvePosPricing(categoryItems, [{ variantId, quantityMilli: 50000 }], customer, 'auto')
    expect(result.lines.get(variantId)?.unitPriceCentavos).toBe(75000)
    expect(
      resolvePosPricing(categoryItems, [{ variantId, quantityMilli: 10000 }], customer, 'retail').totalCentavos,
    ).toBe(999000)
  })
  it('requires explicit category binding; group names alone are not rules', () => {
    expect(resolvePosPricing(items, [{ variantId, quantityMilli: 10000 }], customer, 'auto').priceListId).toBeNull()
  })
  it('uses exact half-up integer money for thousandth quantities', () => {
    const penny = [{ ...items[0]!, retailPriceCentavos: 1 }]
    expect(resolvePosPricing(penny, [{ variantId, quantityMilli: 500 }], null, 'retail').totalCentavos).toBe(1)
    const large = [{ ...items[0]!, retailPriceCentavos: Number.MAX_SAFE_INTEGER }]
    expect(resolvePosPricing(large, [{ variantId, quantityMilli: 1 }], null, 'retail').totalCentavos).toBe(
      Number((BigInt(Number.MAX_SAFE_INTEGER) + 500n) / 1000n),
    )
  })
  it('rejects money overflow, unsafe quantities, duplicates and missing variants', () => {
    expect(
      resolvePosPricing(categoryItems, [{ variantId, quantityMilli: Number.MAX_SAFE_INTEGER + 1 }], customer, 'auto')
        .eligible,
    ).toBe(false)
    expect(
      resolvePosPricing(categoryItems, [{ variantId, quantityMilli: Number.MAX_SAFE_INTEGER }], customer, 'auto')
        .eligible,
    ).toBe(false)
    expect(
      resolvePosPricing(categoryItems, [{ variantId: 'missing', quantityMilli: 1000 }], null, 'auto').eligible,
    ).toBe(false)
    expect(
      resolvePosPricing(
        categoryItems,
        [
          { variantId, quantityMilli: 1000 },
          { variantId, quantityMilli: 1000 },
        ],
        null,
        'auto',
      ).eligible,
    ).toBe(false)
  })
})
