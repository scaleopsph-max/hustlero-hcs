import { expect, it } from 'vitest'
import { catalogImportTemplate, parseCatalogImportCsv } from './catalog-import-file'
it('round-trips a two-size template with explicit SKU grouping and no stock columns', () => {
  const rows = parseCatalogImportCsv(catalogImportTemplate())
  expect(rows).toHaveLength(2)
  expect(rows[0]?.sku).toBe('SHOE-8')
  expect(rows[1]?.product_sku).toBe('SHOE-8')
  expect(Object.keys(rows[0]!)).not.toContain('quantity')
})
it('uses a structured CSV parser for quoted commas, newlines and UTF-8 names', () => {
  const rows = parseCatalogImportCsv('product_name,sku,retail_price\r\n"Sapatos, Café\nSeries A",SHOE-A,499.99')
  expect(rows[0]?.product_name).toBe('Sapatos, Café\nSeries A')
})
it('normalizes supported column labels', () => {
  expect(parseCatalogImportCsv('Product Name,SKU,Retail Price\nShoes,SHOE-8,499')[0]?.retail_price).toBe('499')
})
it.each([
  'sku,retail_price\nSHOE-8,499',
  'product_name,sku,retail_price,quantity\nShoes,SHOE-8,499,10',
  'product_name,sku,SKU,retail_price\nShoes,SHOE-8,SHOE-9,499',
  'product_name,sku,retail_price\nShoes,SHOE-8,499,extra',
  'product_name,sku,retail_price\n',
])('rejects missing/extra/duplicate headers or malformed structure', (csv) =>
  expect(() => parseCatalogImportCsv(csv)).toThrow(),
)
it('rejects oversized text and too many rows before import execution', () => {
  expect(() => parseCatalogImportCsv('x'.repeat(5 * 1024 * 1024 + 1))).toThrow()
  expect(() =>
    parseCatalogImportCsv(
      `product_name,sku,retail_price\n${Array.from({ length: 5001 }, (_, i) => `Shoes,SKU-${i},499`).join('\n')}`,
    ),
  ).toThrow()
})
