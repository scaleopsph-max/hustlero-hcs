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
