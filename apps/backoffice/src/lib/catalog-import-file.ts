import Papa from 'papaparse'
import { catalogImportColumns, type CatalogImportRawRow } from '@hcs/domain'

export function catalogImportTemplate(): string {
  return Papa.unparse([
    [...catalogImportColumns],
    ['SHOE-8', 'Sample shoe', '', '', 'Size 8', 'SHOE-8', '', '499.00', '200.00', 'true'],
    ['SHOE-8', 'Sample shoe', '', '', 'Size 9', 'SHOE-9', '', '499.00', '200.00', 'true'],
  ])
}
export function parseCatalogImportCsv(text: string): CatalogImportRawRow[] {
  if (new TextEncoder().encode(text).byteLength > 5 * 1024 * 1024) throw new Error('CSV must be 5 MB or smaller.')
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) =>
      header
        .trim()
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '_')
        .replaceAll(/^_+|_+$/g, ''),
  })
  if (parsed.errors.length > 0) throw new Error(`Invalid CSV structure at row ${(parsed.errors[0]?.row ?? 0) + 2}.`)
  if (Object.keys(parsed.meta.renamedHeaders ?? {}).length > 0)
    throw new Error('Duplicate CSV headers are not allowed.')
  const headers = parsed.meta.fields ?? []
  for (const required of ['product_name', 'sku', 'retail_price'])
    if (!headers.includes(required)) throw new Error(`Missing column: ${required}.`)
  const unknown = headers.filter(
    (header) => !catalogImportColumns.includes(header as (typeof catalogImportColumns)[number]),
  )
  if (unknown.length > 0) throw new Error(`Unknown catalog column: ${unknown.join(', ')}.`)
  if (parsed.data.length < 1 || parsed.data.length > 5000) throw new Error('CSV must contain 1 to 5,000 rows.')
  return parsed.data
}
