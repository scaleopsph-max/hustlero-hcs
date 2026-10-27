import { expect, it } from 'vitest'
import { planCatalogImport } from '@hcs/domain'
import { catalogImportExecutionResponseSchema } from '@hcs/contracts'
import { restoreImportExecution, reconcileImportExecution } from './catalog-import-execution'
const user = '1b000000-0000-4000-8000-000000000001',
  jobId = '2b000000-0000-4000-8000-000000000001',
  id = '3b000000-0000-4000-8000-000000000001',
  product = '4b000000-0000-4000-8000-000000000001',
  variant = '5b000000-0000-4000-8000-000000000001'
const source = { filename: 'test.csv', rows: [{ product_name: 'Shoes', sku: 'SHOE-8', retail_price: '499.99' }] }
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
const execution = {
  id,
  jobId,
  state: 'completed',
  groupCount: 1,
  nextGroup: 1,
  confirmedBy: user,
  confirmedAt: '2026-10-27T00:00:00Z',
  completedAt: '2026-10-27T00:00:01Z',
  requestKey: 'catalog-import-test-key',
  reviewHash: 'a'.repeat(64),
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
it('retains exact confirmation and explicit group identity', () => {
  for (const command of [
    { kind: 'start', key: user, reviewHash: 'a'.repeat(64) },
    { kind: 'step', executionId: id, groupIndex: 0 },
  ])
    expect(restoreImportExecution(JSON.stringify(command))).toEqual(command)
  expect(restoreImportExecution(null)).toBeNull()
})
it('does not silently discard corrupt or injected pending commands', () => {
  expect(() => restoreImportExecution('{')).toThrow()
  expect(() =>
    restoreImportExecution(JSON.stringify({ kind: 'step', executionId: id, groupIndex: 0, tenantId: user })),
  ).toThrow()
})
it('reconciles terminal results with exact original row identities', () => {
  expect(reconcileImportExecution(job, { execution })?.id).toBe(id)
  expect(reconcileImportExecution(job, { execution: null })).toBeNull()
})
it.each([
  { ...execution, jobId: user },
  { ...execution, results: [{ ...execution.results[0], rowNumber: 3 }] },
  { ...execution, results: [{ ...execution.results[0], outcome: 'updated' }] },
])('rejects another job, row or action', (value) =>
  expect(() => reconcileImportExecution(job, { execution: value })).toThrow(),
)
it.each([
  { ...execution, nextGroup: 0 },
  { ...execution, state: 'running' },
  { ...execution, results: [...execution.results, ...execution.results] },
  { ...execution, results: [{ ...execution.results[0], errorCode: 'HCIS1' }] },
  { ...execution, state: 'completed_with_errors' },
])('rejects inconsistent execution counters/outcomes', (value) =>
  expect(catalogImportExecutionResponseSchema.safeParse({ execution: value }).success).toBe(false),
)
it('does not accept partial results for an atomic product group', () => {
  const rows = [...job.rows, { ...job.rows[0]!, rowNumber: 3, sku: 'SHOE-9', action: 'create_variant' as const }]
  expect(() =>
    reconcileImportExecution(
      { ...job, rowCount: 2, proposedCreates: 2, source: { ...source, rows: [...source.rows, ...source.rows] }, rows },
      { execution: { ...execution, state: 'running', groupCount: 2, nextGroup: 1, completedAt: null } },
    ),
  ).toThrow()
})
it('requires unchanged update target product/variant IDs', () => {
  const update = {
    ...job,
    proposedCreates: 0,
    proposedUpdates: 1,
    rows: [{ ...job.rows[0]!, action: 'update_variant' as const, productId: product, variantId: variant }],
  }
  expect(() =>
    reconcileImportExecution(update, {
      execution: { ...execution, results: [{ ...execution.results[0], outcome: 'updated', variantId: user }] },
    }),
  ).toThrow()
})
