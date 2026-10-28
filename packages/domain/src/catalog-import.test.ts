import { expect, it } from 'vitest'
import {
  catalogImportMoney,
  planCatalogImport,
  type CatalogImportRawRow,
  type CatalogImportSnapshot,
} from './catalog-import'
const base: CatalogImportRawRow = {
  product_name: 'Shoes',
  sku: 'NEW-8',
  category: 'Shoes',
  variant_name: 'Size 8',
  retail_price: '499.00',
  unit_cost: '200.00',
  track_inventory: 'true',
}
const snapshot: CatalogImportSnapshot = {
  categories: [{ id: 'cat', name: 'Shoes', status: 'active' }],
  products: [
    {
      id: 'product',
      name: 'Existing',
      description: null,
      categoryId: 'cat',
      status: 'active',
      variants: [{ id: 'variant', sku: 'OLD-8', isActive: true, trackInventory: true, barcodes: ['480001'] }],
    },
  ],
}
it.each([
  ['0', 0],
  ['0.01', 1],
  ['499.99', 49999],
  ['999999999.99', 99999999999],
])('parses exact decimal %s', (text, minor) => expect(catalogImportMoney(String(text))).toBe(minor))
it.each(['', '-1', '1.001', '1e3', 'NaN', 'Infinity', '1,000.00', 'PHP 10', '1000000000', '01.00'])(
  'rejects invalid/out-of-range money %s',
  (value) => expect(() => catalogImportMoney(value)).toThrow(),
)
it('plans a new product without stock fields or name-based matching', () => {
  const row = planCatalogImport([base], snapshot)[0]!
  expect(row.issues).toEqual([])
  expect(row.action).toBe('create_product')
  expect(row.productId).toBeNull()
  expect(row.categoryId).toBe('cat')
  expect(row.retailPriceMinor).toBe(49900)
  expect(Object.keys(row)).not.toContain('quantity')
})
it('uses SKU for existing variants and retains all original barcodes', () => {
  const row = planCatalogImport([{ ...base, sku: 'old-8', barcode: '480002' }], snapshot)[0]!
  expect(row.action).toBe('update_variant')
  expect(row.variantId).toBe('variant')
  expect(row.barcodes).toEqual(['480001', '480002'])
})
it('does not rename a SKU just because a barcode belongs to an existing item', () => {
  expect(planCatalogImport([{ ...base, barcode: '480001' }], snapshot)[0]!.issues).toContainEqual({
    code: 'BARCODE_ASSIGNED_TO_OTHER_SKU',
    field: 'barcode',
  })
})
it('requires explicit parent SKU for grouping new variants; row order is irrelevant', () => {
  const rows = planCatalogImport(
    [{ ...base, sku: 'NEW-9', product_sku: 'NEW-8', variant_name: 'Size 9' }, base],
    snapshot,
  )
  expect(rows.map((row) => row.issues)).toEqual([[], []])
  expect(rows.map((row) => row.action)).toEqual(['create_variant', 'create_product'])
})
it('adds a variant only through an explicit existing parent SKU', () => {
  const row = planCatalogImport([{ ...base, product_sku: 'OLD-8' }], snapshot)[0]!
  expect(row.action).toBe('create_variant')
  expect(row.productId).toBe('product')
})
it('marks duplicate SKU and barcode on every offending row', () => {
  const rows = planCatalogImport(
    [
      { ...base, barcode: '480099' },
      { ...base, sku: 'new-8', barcode: '480099' },
    ],
    snapshot,
  )
  for (const row of rows) {
    expect(row.action).toBeNull()
    expect(row.issues.some((issue) => issue.code === 'DUPLICATE_FILE_SKU')).toBe(true)
    expect(row.issues.some((issue) => issue.code === 'DUPLICATE_FILE_BARCODE')).toBe(true)
  }
})
it.each(['Missing', 'Archived'])('rejects unknown or archived category %s', (category) => {
  const data = structuredClone(snapshot)
  data.categories.push({ id: 'archived', name: 'Archived', status: 'archived' })
  expect(planCatalogImport([{ ...base, category }], data)[0]!.issues).toContainEqual({
    code: 'UNKNOWN_CATEGORY',
    field: 'category',
  })
})
it('rejects inconsistent product metadata in one explicit group', () => {
  const rows = planCatalogImport(
    [base, { ...base, sku: 'NEW-9', product_sku: 'NEW-8', product_name: 'Different' }],
    snapshot,
  )
  expect(rows.every((row) => row.issues.some((issue) => issue.code === 'CONFLICTING_PRODUCT_DETAILS'))).toBe(true)
})
it('rejects unknown parent and propagates rejected parent rows', () => {
  expect(planCatalogImport([{ ...base, product_sku: 'UNKNOWN' }], snapshot)[0]!.action).toBeNull()
  const rows = planCatalogImport(
    [
      { ...base, retail_price: 'bad' },
      { ...base, sku: 'NEW-9', product_sku: 'NEW-8' },
    ],
    snapshot,
  )
  expect(rows[1]!.issues).toContainEqual({ code: 'PARENT_ROW_REJECTED', field: 'product_sku' })
})
it('does not change existing inventory tracking or reactivate inactive items', () => {
  expect(planCatalogImport([{ ...base, sku: 'OLD-8', track_inventory: 'false' }], snapshot)[0]!.issues).toContainEqual({
    code: 'TRACKING_CHANGE_REQUIRES_MANUAL_EDIT',
    field: 'track_inventory',
  })
  const data = structuredClone(snapshot)
  data.products[0]!.variants[0]!.isActive = false
  expect(planCatalogImport([{ ...base, sku: 'OLD-8' }], data)[0]!.issues).toContainEqual({
    code: 'INACTIVE_EXISTING_ITEM',
    field: 'sku',
  })
})
it('refuses stock columns and bounds file row counts', () => {
  expect(planCatalogImport([{ ...base, quantity: '100' } as CatalogImportRawRow], snapshot)[0]!.issues).toContainEqual({
    code: 'UNKNOWN_COLUMN',
    field: 'quantity',
  })
  expect(() => planCatalogImport([], snapshot)).toThrow()
  expect(() =>
    planCatalogImport(
      Array.from({ length: 5001 }, () => base),
      snapshot,
    ),
  ).toThrow()
})
it('does not mutate the file or authorized catalog snapshot', () => {
  const rows = structuredClone([base]),
    data = structuredClone(snapshot)
  planCatalogImport(rows, data)
  expect(rows).toEqual([base])
  expect(data).toEqual(snapshot)
})
it('bounds money text and merged barcodes without dropping existing identifiers', () => {
  expect(() => catalogImportMoney('9'.repeat(100000))).toThrow()
  const data = structuredClone(snapshot)
  data.products[0]!.variants[0]!.barcodes = Array.from({ length: 10 }, (_, i) => `48000${i}`)
  const row = planCatalogImport([{ ...base, sku: 'OLD-8', barcode: '480099' }], data)[0]!
  expect(row.issues).toContainEqual({ code: 'BARCODE_LIMIT', field: 'barcode' })
  expect(row.barcodes).toHaveLength(11)
  expect(row.action).toBeNull()
})
it('plans the maximum 5,000-row file without product-name grouping', () => {
  const rows = planCatalogImport(
    Array.from({ length: 5000 }, (_, i) => ({ ...base, sku: `BULK-${i}` })),
    snapshot,
  )
  expect(rows).toHaveLength(5000)
  expect(rows.every((row) => row.action === 'create_product' && row.issues.length === 0)).toBe(true)
})
it('does not move an existing SKU under a newly created product', () => {
  const rows = planCatalogImport([base, { ...base, sku: 'OLD-8', product_sku: 'NEW-8' }], snapshot)
  expect(rows[1]!.issues).toContainEqual({ code: 'CANNOT_MOVE_EXISTING_VARIANT', field: 'product_sku' })
  expect(rows[1]!.action).toBeNull()
})
it('rejects conflicting product metadata through different existing parent aliases', () => {
  const data = structuredClone(snapshot)
  data.products[0]!.variants.push({ id: 'variant2', sku: 'OLD-9', isActive: true, trackInventory: true, barcodes: [] })
  const rows = planCatalogImport(
    [
      { ...base, sku: 'OLD-8' },
      { ...base, sku: 'OLD-9', product_name: 'Conflicting' },
    ],
    data,
  )
  expect(rows.every((row) => row.action === null)).toBe(true)
  expect(rows.every((row) => row.issues.some((issue) => issue.code === 'CONFLICTING_PRODUCT_DETAILS'))).toBe(true)
})
