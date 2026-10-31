import type { ResellerCatalogItem } from '@hcs/contracts'
import { describe, expect, it } from 'vitest'

import { filterGroups, groupCatalog, showNewBadges } from './catalog'

const shirt = '51000000-0000-4000-8000-000000000001'
const cap = '51000000-0000-4000-8000-000000000002'

const item = (overrides: Partial<ResellerCatalogItem>): ResellerCatalogItem => ({
  variantId: '50000000-0000-4000-8000-000000000001',
  productId: shirt,
  productName: 'Triple Black',
  variantName: 'Small',
  sku: 'LR-0002',
  categoryName: 'SHIRT',
  unitPriceMinor: 65_000,
  srpMinor: 89_900,
  pricingGroupId: '52000000-0000-4000-8000-000000000001',
  pricingGroupName: 'Core products',
  thresholdMilli: 6_000,
  stockStatus: 'out_of_stock',
  imageUrl: null,
  thumbUrl: null,
  ...overrides,
})

const items = [
  item({}),
  item({
    variantId: '50000000-0000-4000-8000-000000000002',
    productId: cap,
    productName: 'Cap',
    variantName: 'One size',
    sku: 'CAP-1',
    categoryName: 'HATS',
    stockStatus: 'in_stock',
  }),
  item({
    variantId: '50000000-0000-4000-8000-000000000003',
    variantName: 'XL',
    sku: 'LR-0001',
    unitPriceMinor: 70_000,
    stockStatus: 'low_stock',
    thumbUrl: '/v1/files/content?thumb',
    imageUrl: '/v1/files/content?main',
  }),
]

describe('groupCatalog', () => {
  it('collects variants under one product card in API order', () => {
    const groups = groupCatalog(items)
    expect(groups.map((group) => group.productName)).toEqual(['Triple Black', 'Cap'])
    expect(groups[0]?.variants.map((variant) => variant.sku)).toEqual(['LR-0002', 'LR-0001'])
  })

  it('summarizes price range, best stock, and the first available photo', () => {
    const [shirtGroup] = groupCatalog(items)
    expect(shirtGroup).toMatchObject({
      minPriceMinor: 65_000,
      maxPriceMinor: 70_000,
      stockStatus: 'low_stock',
      thumbUrl: '/v1/files/content?thumb',
      imageUrl: '/v1/files/content?main',
    })
  })
})

describe('filterGroups', () => {
  const groups = groupCatalog(items)
  const all = { search: '', category: null, availableOnly: false }

  it('matches product names, variant names, and SKUs', () => {
    expect(filterGroups(groups, { ...all, search: 'triple' }).map((group) => group.productId)).toEqual([shirt])
    expect(filterGroups(groups, { ...all, search: 'lr-0001' }).map((group) => group.productId)).toEqual([shirt])
    expect(filterGroups(groups, { ...all, search: 'one size' }).map((group) => group.productId)).toEqual([cap])
  })

  it('filters by category and keeps products with any available variant', () => {
    expect(filterGroups(groups, { ...all, category: 'HATS' }).map((group) => group.productId)).toEqual([cap])
    const outOnly = groupCatalog([item({})])
    expect(filterGroups(outOnly, { ...all, availableOnly: true })).toEqual([])
    expect(filterGroups(groups, { ...all, availableOnly: true })).toHaveLength(2)
  })
})

describe('favorites and new products', () => {
  const marked = groupCatalog([
    item({ isFavorite: true }),
    item({ variantId: '50000000-0000-4000-8000-000000000002', productId: cap, productName: 'Cap', isNew: true }),
  ])
  const all = { search: '', category: null, availableOnly: false }

  it('filters to favorites or new products', () => {
    expect(filterGroups(marked, { ...all, favoritesOnly: true }).map((group) => group.productName)).toEqual([
      'Triple Black',
    ])
    expect(filterGroups(marked, { ...all, newOnly: true }).map((group) => group.productName)).toEqual(['Cap'])
  })

  it('shows New badges only when some products are not new', () => {
    expect(showNewBadges(marked)).toBe(true)
    expect(showNewBadges(groupCatalog([item({ isNew: true })]))).toBe(false)
    expect(showNewBadges(groupCatalog([item({})]))).toBe(false)
  })
})
