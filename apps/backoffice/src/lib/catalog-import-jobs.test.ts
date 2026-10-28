import { expect, it } from 'vitest'
import { planCatalogImport } from '@hcs/domain'
import { catalogImportJobSchema } from '@hcs/contracts'
import { restoreImportSave, sameImportSave, reconcileImportSave } from './catalog-import-jobs'
const command = {
  key: '18000000-0000-4000-8000-000000000001',
  payload: { filename: 'test.csv', rows: [{ product_name: 'Shoe', sku: 'SHOE-8', retail_price: '499.99' }] },
}
const id = '28000000-0000-4000-8000-000000000001'
const detail = {
  id,
  filename: 'test.csv',
  uploaderId: command.key,
  state: 'preview',
  rowCount: 1,
  rejectedCount: 0,
  proposedCreates: 1,
  proposedUpdates: 0,
  createdAt: '2026-10-27T00:00:00Z',
  cancelledAt: null,
  source: command.payload,
  rows: planCatalogImport(command.payload.rows, { categories: [], products: [] }),
}
it('restores the exact immutable raw request and key', () => {
  expect(restoreImportSave(JSON.stringify(command))).toEqual(command)
  expect(restoreImportSave(null)).toBeNull()
})
it('does not silently discard corrupt pending writes', () => {
  expect(() => restoreImportSave('{')).toThrow()
  expect(() => restoreImportSave(JSON.stringify({ ...command, key: 'bad' }))).toThrow()
})
it('matches the body as well as the key before clearing pending state', () => {
  expect(sameImportSave(command, command)).toBe(true)
  expect(sameImportSave(command, null)).toBe(false)
  expect(sameImportSave(command, { ...command, payload: { ...command.payload, filename: 'other.csv' } })).toBe(false)
})
it('reconciles a recovered saved job including exact input, not only filename/row count', () => {
  expect(reconcileImportSave(command, { jobId: id, status: 'saved' }, detail).id).toBe(id)
  expect(() =>
    reconcileImportSave(
      command,
      { jobId: id, status: 'saved' },
      { ...detail, source: { ...command.payload, rows: [{ ...command.payload.rows[0], retail_price: '1.00' }] } },
    ),
  ).toThrow(/reconciled/)
})
it('rejects another job ID', () =>
  expect(() => reconcileImportSave(command, { jobId: command.key, status: 'saved' }, detail)).toThrow(/reconciled/))
it.each([
  { ...detail, rowCount: 2 },
  { ...detail, proposedCreates: 0 },
  { ...detail, rejectedCount: 1 },
  { ...detail, state: 'cancelled' },
  { ...detail, rows: [{ ...detail.rows[0], rowNumber: 3 }] },
])('rejects unreconciled job details', (value) => expect(catalogImportJobSchema.safeParse(value).success).toBe(false))
