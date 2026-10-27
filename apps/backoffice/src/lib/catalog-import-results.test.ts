import { expect, it } from 'vitest'
import Papa from 'papaparse'
import { planCatalogImport } from '@hcs/domain'
import type { CatalogImportExecution } from '@hcs/contracts'
import { catalogImportResultsCsv } from './catalog-import-results'
const user = '1d000000-0000-4000-8000-000000000001',
  jobId = '2d000000-0000-4000-8000-000000000001',
  executionId = '3d000000-0000-4000-8000-000000000001',
  product = '4d000000-0000-4000-8000-000000000001',
  variant = '5d000000-0000-4000-8000-000000000001'
const source = {
  filename: 'test.csv',
  rows: [{ product_name: 'Shoes', sku: '000123', retail_price: '499.99', unit_cost: '200.01' }],
}
const job = {
  id: jobId,
  filename: source.filename,
  uploaderId: user,
  state: 'preview' as const,
  rowCount: 1,
  rejectedCount: 0,
  proposedCreates: 1,
  proposedUpdates: 0,
  createdAt: '2026-10-27T00:00:00Z',
  cancelledAt: null,
  source,
  rows: planCatalogImport(source.rows, { categories: [], products: [] }),
}
const execution: CatalogImportExecution = {
  id: executionId,
  jobId,
  state: 'completed',
  groupCount: 1,
  nextGroup: 1,
  confirmedBy: user,
  requestKey: 'synthetic-results-key',
  reviewHash: 'a'.repeat(64),
  confirmedAt: '2026-10-27T00:00:00Z',
  completedAt: '2026-10-27T00:00:01Z',
  results: [
    {
      groupIndex: 0,
      rowNumber: 2,
      outcome: 'created',
      productId: product,
      variantId: variant,
      errorCode: null,
      recordedAt: '2026-10-27T00:00:01Z',
    },
  ],
}
function parse(csv: string) {
  return Papa.parse<Record<string, string>>(csv, { header: true }).data
}
it('exports exact planned prices and committed identities with source row numbers', () => {
  const [row] = parse(catalogImportResultsCsv(job, execution))
  expect(row).toMatchObject({
    'CSV row': '2',
    'Planned retail PHP': '499.99',
    'Planned unit cost PHP': '200.01',
    Result: 'created',
    'Result product ID': product,
    'Result variant ID': variant,
    'Job ID': jobId,
    'Execution ID': executionId,
  })
})
it('preserves zero-prefixed numeric SKU identities as text for spreadsheets', () => {
  expect(parse(catalogImportResultsCsv(job, execution))[0]).toMatchObject({ SKU: "'000123", 'Product SKU': "'000123" })
})
it.each(['=HYPERLINK("https://example.invalid", "x")', '+1+1', '-1+1', '@SUM(A1)', '  =1+1', '\t=1+1', '\n=1+1'])(
  'escapes formula-like product names %j',
  (name) => {
    const changed = { ...job, rows: [{ ...job.rows[0]!, name }] }
    expect(parse(catalogImportResultsCsv(changed, execution))[0]?.Product).toBe(`'${name}`)
  },
)
it('round trips quoted commas, newlines and Unicode without corrupting columns', () => {
  const name = 'Shoes, "Blue"\nMay sukat'
  expect(parse(catalogImportResultsCsv({ ...job, rows: [{ ...job.rows[0]!, name }] }, execution))[0]?.Product).toBe(
    name,
  )
})
it('marks unprocessed rows pending, not failed or created', () => {
  const extraSource = {
    ...source,
    rows: [...source.rows, { product_name: 'Second shoe', sku: 'SECOND', retail_price: '1.01', unit_cost: '' }],
  }
  const changed = {
    ...job,
    rowCount: 2,
    proposedCreates: 2,
    source: extraSource,
    rows: planCatalogImport(extraSource.rows, { categories: [], products: [] }),
  }
  const rows = parse(
    catalogImportResultsCsv(changed, {
      ...execution,
      state: 'running',
      groupCount: 2,
      nextGroup: 1,
      completedAt: null,
    }),
  )
  expect(rows[1]).toMatchObject({
    Result: 'pending',
    'Result product ID': '',
    'Result variant ID': '',
    'Error code': '',
    'Recorded at': '',
    'Planned retail PHP': '1.01',
  })
})
it('does not imply that rejected group prices or targets were applied', () => {
  const failed: CatalogImportExecution = {
    ...execution,
    state: 'completed_with_errors',
    results: [{ ...execution.results[0]!, outcome: 'failed', productId: null, variantId: null, errorCode: 'HCIS1' }],
  }
  expect(parse(catalogImportResultsCsv(job, failed))[0]).toMatchObject({
    Result: 'failed',
    'Error code': 'HCIS1',
    'Result product ID': '',
    'Planned retail PHP': '499.99',
  })
})
it.each([0, 1, 99, 100, 99_999_999_999])('formats exact minor amount %s without float arithmetic', (minor) => {
  const text = `${BigInt(minor) / 100n}.${String(BigInt(minor) % 100n).padStart(2, '0')}`
  expect(
    parse(catalogImportResultsCsv({ ...job, rows: [{ ...job.rows[0]!, retailPriceMinor: minor }] }, execution))[0]?.[
      'Planned retail PHP'
    ],
  ).toBe(text)
})
it('rejects wrong-job data before building an export', () => {
  expect(() => catalogImportResultsCsv(job, { ...execution, jobId: user })).toThrow()
})
