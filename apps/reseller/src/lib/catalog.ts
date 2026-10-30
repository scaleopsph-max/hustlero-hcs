import type { ResellerCatalogItem, ResellerStockStatus } from '@hcs/contracts'

/** One catalog card: a product with all of its sellable variants. */
export type ProductGroup = {
  productId: string
  productName: string
  categoryName: string | null
  imageUrl: string | null
  thumbUrl: string | null
  variants: ResellerCatalogItem[]
  minPriceMinor: number
  maxPriceMinor: number
  /** Best availability across the variants: in stock beats low stock beats out of stock. */
  stockStatus: ResellerStockStatus
}

const stockRank: Record<ResellerStockStatus, number> = { in_stock: 0, low_stock: 1, out_of_stock: 2 }

/** Groups catalog rows by product, keeping the API's order for products and their variants. */
export function groupCatalog(items: ResellerCatalogItem[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>()
  for (const item of items) {
    const group = groups.get(item.productId)
    if (!group) {
      groups.set(item.productId, {
        productId: item.productId,
        productName: item.productName,
        categoryName: item.categoryName,
        imageUrl: item.imageUrl ?? null,
        thumbUrl: item.thumbUrl ?? null,
        variants: [item],
        minPriceMinor: item.unitPriceMinor,
        maxPriceMinor: item.unitPriceMinor,
        stockStatus: item.stockStatus,
      })
      continue
    }
    group.variants.push(item)
    group.imageUrl ??= item.imageUrl ?? null
    group.thumbUrl ??= item.thumbUrl ?? null
    group.categoryName ??= item.categoryName
    group.minPriceMinor = Math.min(group.minPriceMinor, item.unitPriceMinor)
    group.maxPriceMinor = Math.max(group.maxPriceMinor, item.unitPriceMinor)
    if (stockRank[item.stockStatus] < stockRank[group.stockStatus]) group.stockStatus = item.stockStatus
  }
  return [...groups.values()]
}

/** Keeps products whose name, or any variant name or SKU, matches the search and the filters. */
export function filterGroups(
  groups: ProductGroup[],
  filters: { search: string; category: string | null; availableOnly: boolean },
): ProductGroup[] {
  const term = filters.search.trim().toLowerCase()
  return groups.filter(
    (group) =>
      (!filters.category || group.categoryName === filters.category) &&
      (!filters.availableOnly || group.stockStatus !== 'out_of_stock') &&
      (!term ||
        group.productName.toLowerCase().includes(term) ||
        group.variants.some((variant) => `${variant.variantName} ${variant.sku}`.toLowerCase().includes(term))),
  )
}
