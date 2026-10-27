import { catalogImportJobSchema, type CatalogImportJob, type CatalogImportExecution } from '@hcs/contracts'
import { reconcileImportExecution } from './catalog-import-execution'
import { reportCsv } from './report-csv'
const decimal = (minor: number) => {
  const value = BigInt(minor)
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`
}
const identifier = (value: string) => (/^\d+$/.test(value) ? `'${value}` : value)
export function catalogImportErrorLabel(code: string | null) {
  if (code === null) return '-'
  const labels: Record<string, string> = {
    HCIS1: 'Catalog changed since review',
    '23505': 'SKU or barcode already in use',
    HCS11: 'Invalid catalog row',
    HCS12: 'Catalog item unavailable',
  }
  return labels[code] ?? 'Processing rejected'
}
export function catalogImportResultsCsv(job: CatalogImportJob, execution: CatalogImportExecution): string {
  const source = catalogImportJobSchema.parse(job),
    verified = reconcileImportExecution(source, { execution })
  if (!verified) throw new Error('Import execution is unavailable.')
  const results = new Map(verified.results.map((row) => [row.rowNumber, row]))
  return reportCsv([
    [
      'Job ID',
      'Execution ID',
      'Import state',
      'CSV row',
      'Product SKU',
      'SKU',
      'Product',
      'Variant',
      'Proposed action',
      'Result',
      'Result product ID',
      'Result variant ID',
      'Planned retail PHP',
      'Planned unit cost PHP',
      'Error code',
      'Error',
      'Recorded at',
    ],
    ...source.rows.map((row) => {
      const result = results.get(row.rowNumber)
      return [
        source.id,
        verified.id,
        verified.state,
        row.rowNumber,
        identifier(row.productSku),
        identifier(row.sku),
        row.name,
        row.variantName,
        row.action ?? 'rejected',
        result?.outcome ?? 'pending',
        result?.productId ?? '',
        result?.variantId ?? '',
        row.retailPriceMinor === null ? '' : decimal(row.retailPriceMinor),
        row.unitCostMinor === null ? '' : decimal(row.unitCostMinor),
        result?.errorCode ?? '',
        result?.errorCode ? catalogImportErrorLabel(result.errorCode) : '',
        result?.recordedAt ?? '',
      ]
    }),
  ])
}
