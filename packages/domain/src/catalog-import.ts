/** Catalog-only planning: no stock, category creation, name-based matching or writes. */
export const catalogImportColumns = [
  'product_sku',
  'product_name',
  'description',
  'category',
  'variant_name',
  'sku',
  'barcode',
  'retail_price',
  'unit_cost',
  'track_inventory',
] as const
export type CatalogImportRawRow = Partial<Record<(typeof catalogImportColumns)[number], string | undefined>>
export type CatalogImportSnapshot = {
  categories: { id: string; name: string; status: 'active' | 'archived' }[]
  products: {
    id: string
    name: string
    description: string | null
    categoryId: string | null
    status: 'active' | 'inactive' | 'archived'
    variants: { id: string; sku: string; isActive: boolean; trackInventory: boolean; barcodes: string[] }[]
  }[]
}
export type CatalogImportIssue = { code: string; field: string }
export type CatalogImportPlannedRow = {
  rowNumber: number
  issues: CatalogImportIssue[]
  action: 'create_product' | 'create_variant' | 'update_variant' | null
  productId: string | null
  variantId: string | null
  productSku: string
  name: string
  description: string | null
  categoryId: string | null
  categoryName: string | null
  variantName: string
  sku: string
  barcodes: string[]
  retailPriceMinor: number | null
  unitCostMinor: number | null
  trackInventory: boolean
}
export function catalogImportMoney(value: string): number {
  if (value.length > 24) throw new Error('Money text exceeds catalog limit.')
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) throw new Error('Invalid decimal money.')
  const minor = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
  if (minor > 99_999_999_999n) throw new Error('Money exceeds catalog limit.')
  return Number(minor)
}
export function planCatalogImport(
  raw: CatalogImportRawRow[],
  snapshot: CatalogImportSnapshot,
): CatalogImportPlannedRow[] {
  if (raw.length < 1 || raw.length > 5000) throw new Error('Catalog import needs 1 to 5,000 rows.')
  const canonical = (text: string) => text.trim().toUpperCase()
  const variants = snapshot.products.flatMap((product) => product.variants.map((variant) => ({ product, variant })))
  const bySku = new Map<string, typeof variants>()
  const byBarcode = new Map<string, typeof variants>()
  const categories = new Map<string, CatalogImportSnapshot['categories']>()
  for (const category of snapshot.categories) {
    const name = category.name.trim().toLowerCase()
    const entries = categories.get(name) ?? []
    entries.push(category)
    categories.set(name, entries)
  }
  for (const item of variants) {
    const sku = canonical(item.variant.sku)
    const entries = bySku.get(sku) ?? []
    entries.push(item)
    bySku.set(sku, entries)
    for (const value of item.variant.barcodes) {
      const barcode = canonical(value)
      const owners = byBarcode.get(barcode) ?? []
      owners.push(item)
      byBarcode.set(barcode, owners)
    }
  }
  const rows = raw.map((input, index): CatalogImportPlannedRow => {
    const issues: CatalogImportIssue[] = []
    const issue = (code: string, field: string) => issues.push({ code, field })
    for (const field of Object.keys(input))
      if (!catalogImportColumns.includes(field as (typeof catalogImportColumns)[number])) issue('UNKNOWN_COLUMN', field)
    const text = (field: (typeof catalogImportColumns)[number], max: number) => {
      const value = input[field]?.trim() ?? ''
      if (value.length > max) issue('TOO_LONG', field)
      return value
    }
    const sku = canonical(text('sku', 64)),
      productSku = canonical(text('product_sku', 64)) || sku
    const name = text('product_name', 120),
      variantName = text('variant_name', 80) || 'Default',
      description = text('description', 1000) || null
    const category = text('category', 80),
      barcode = canonical(text('barcode', 64))
    if (!sku || !/^[A-Z0-9._-]+$/.test(sku)) issue('INVALID_SKU', 'sku')
    if (!productSku || !/^[A-Z0-9._-]+$/.test(productSku)) issue('INVALID_PRODUCT_SKU', 'product_sku')
    if (!name) issue('REQUIRED', 'product_name')
    if (barcode && !/^[A-Z0-9._-]{3,64}$/.test(barcode)) issue('INVALID_BARCODE', 'barcode')
    const categoryMatches = categories.get(category.toLowerCase()) ?? []
    if (category && (categoryMatches.length !== 1 || categoryMatches[0]!.status !== 'active'))
      issue('UNKNOWN_CATEGORY', 'category')
    const match = bySku.get(sku) ?? []
    if (match.length > 1) issue('AMBIGUOUS_EXISTING_SKU', 'sku')
    const existing = match.length === 1 ? match[0] : undefined
    if (existing && (!existing.variant.isActive || existing.product.status !== 'active'))
      issue('INACTIVE_EXISTING_ITEM', 'sku')
    if (barcode) {
      const owners = byBarcode.get(barcode) ?? []
      if (owners.some((item) => item.variant.id !== existing?.variant.id))
        issue('BARCODE_ASSIGNED_TO_OTHER_SKU', 'barcode')
    }
    let retailPriceMinor: number | null = null,
      unitCostMinor: number | null = null
    try {
      retailPriceMinor = catalogImportMoney(text('retail_price', 24))
    } catch {
      issue('INVALID_PRICE', 'retail_price')
    }
    const cost = text('unit_cost', 24)
    if (cost)
      try {
        unitCostMinor = catalogImportMoney(cost)
      } catch {
        issue('INVALID_COST', 'unit_cost')
      }
    const tracking = text('track_inventory', 5).toLowerCase()
    if (tracking !== '' && tracking !== 'true' && tracking !== 'false') issue('INVALID_BOOLEAN', 'track_inventory')
    const trackInventory = tracking === '' ? (existing?.variant.trackInventory ?? true) : tracking === 'true'
    if (existing && trackInventory !== existing.variant.trackInventory)
      issue('TRACKING_CHANGE_REQUIRES_MANUAL_EDIT', 'track_inventory')
    const barcodes = [...new Set([...(existing?.variant.barcodes.map(canonical) ?? []), ...(barcode ? [barcode] : [])])]
    if (barcodes.length > 10) issue('BARCODE_LIMIT', 'barcode')
    return {
      rowNumber: index + 2,
      issues,
      action: null,
      productId: existing?.product.id ?? null,
      variantId: existing?.variant.id ?? null,
      productSku,
      name,
      description,
      categoryId: categoryMatches[0]?.id ?? null,
      categoryName: categoryMatches[0]?.name ?? (category || null),
      variantName,
      sku,
      barcodes,
      retailPriceMinor,
      unitCostMinor,
      trackInventory,
    }
  })
  const indexRows = (field: 'sku' | 'productSku') => {
    const map = new Map<string, CatalogImportPlannedRow[]>()
    for (const row of rows) {
      const entries = map.get(row[field]) ?? []
      entries.push(row)
      map.set(row[field], entries)
    }
    return map
  }
  const byInputSku = indexRows('sku'),
    groups = indexRows('productSku')
  for (const group of byInputSku.values())
    if (group.length > 1) for (const row of group) row.issues.push({ code: 'DUPLICATE_FILE_SKU', field: 'sku' })
  const inputBarcodes = new Map<string, CatalogImportPlannedRow[]>()
  for (let i = 0; i < raw.length; i++) {
    const barcode = canonical(raw[i]!.barcode ?? '')
    if (barcode) {
      const entries = inputBarcodes.get(barcode) ?? []
      entries.push(rows[i]!)
      inputBarcodes.set(barcode, entries)
    }
  }
  for (const group of inputBarcodes.values())
    if (group.length > 1) for (const row of group) row.issues.push({ code: 'DUPLICATE_FILE_BARCODE', field: 'barcode' })
  for (const [parentSku, group] of groups) {
    const parentMatches = bySku.get(parentSku) ?? []
    const existingParent = parentMatches.length === 1 ? parentMatches[0] : undefined
    const newParentRows = byInputSku.get(parentSku) ?? []
    const newParent = newParentRows.length === 1 ? newParentRows[0] : undefined
    const validParent = existingParent
      ? existingParent.product.status === 'active' && existingParent.variant.isActive
      : newParent?.productSku === parentSku && newParent.variantId === null
    if (!validParent) for (const row of group) row.issues.push({ code: 'UNKNOWN_PRODUCT_SKU', field: 'product_sku' })
    const details = new Set(group.map((row) => JSON.stringify([row.name, row.description, row.categoryId])))
    if (details.size > 1)
      for (const row of group) row.issues.push({ code: 'CONFLICTING_PRODUCT_DETAILS', field: 'product_sku' })
    for (const row of group) {
      if (
        (row.variantId !== null && !existingParent) ||
        (existingParent && row.productId !== null && row.productId !== existingParent.product.id)
      )
        row.issues.push({ code: 'CANNOT_MOVE_EXISTING_VARIANT', field: 'product_sku' })
      if (existingParent) row.productId = existingParent.product.id
      row.action = row.variantId
        ? 'update_variant'
        : existingParent || row.sku !== parentSku
          ? 'create_variant'
          : 'create_product'
    }
  }
  // A rejected parent must never leave its dependent new variants apparently valid.
  const existingProducts = new Map<string, CatalogImportPlannedRow[]>()
  for (const row of rows)
    if (row.productId !== null) {
      const entries = existingProducts.get(row.productId) ?? []
      entries.push(row)
      existingProducts.set(row.productId, entries)
    }
  for (const group of existingProducts.values()) {
    if (new Set(group.map((row) => JSON.stringify([row.name, row.description, row.categoryId]))).size > 1)
      for (const row of group) row.issues.push({ code: 'CONFLICTING_PRODUCT_DETAILS', field: 'product_sku' })
  }
  for (const group of groups.values()) {
    const parent = group.find((row) => row.sku === row.productSku)
    if (parent && parent.issues.length > 0)
      for (const row of group)
        if (row !== parent) row.issues.push({ code: 'PARENT_ROW_REJECTED', field: 'product_sku' })
  }
  for (const row of rows) if (row.issues.length > 0) row.action = null
  return rows
}
