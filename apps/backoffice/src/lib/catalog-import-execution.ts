import { z } from 'zod'
import {
  catalogImportExecutionResponseSchema,
  type CatalogImportJob,
  type CatalogImportExecution,
} from '@hcs/contracts'
export const pendingImportExecutionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('start'), key: z.uuid(), reviewHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ kind: z.literal('step'), executionId: z.uuid(), groupIndex: z.number().int().min(0).max(4999) }),
])
export type PendingImportExecution = z.infer<typeof pendingImportExecutionSchema>
export function restoreImportExecution(value: string | null) {
  return value === null ? null : pendingImportExecutionSchema.parse(JSON.parse(value))
}
export function reconcileImportExecution(job: CatalogImportJob, value: unknown): CatalogImportExecution | null {
  const execution = catalogImportExecutionResponseSchema.parse(value).execution
  if (!execution) return null
  const expected = new Map(job.rows.map((row) => [row.rowNumber, row]))
  const groups = new Map<string, number[]>()
  for (const row of job.rows) {
    const key = row.productId ? `product:${row.productId}` : `sku:${row.productSku}`
    const group = groups.get(key) ?? []
    group.push(row.rowNumber)
    groups.set(key, group)
  }
  const results = new Map(execution.results.map((row) => [row.rowNumber, row]))
  const variantIds = execution.results.filter((row) => row.outcome !== 'failed').map((row) => row.variantId)
  const productGroups = new Map<string, string>()
  for (const result of execution.results) {
    if (result.outcome === 'failed' || result.productId === null) continue
    const row = expected.get(result.rowNumber)
    if (!row) throw new Error('Import results include an unknown source row.')
    const group = row.productId ? `product:${row.productId}` : `sku:${row.productSku}`,
      prior = productGroups.get(result.productId)
    if (prior !== undefined && prior !== group)
      throw new Error('Separate product groups cannot share one posted product.')
    productGroups.set(result.productId, group)
  }
  if (
    execution.jobId !== job.id ||
    new Set(variantIds).size !== variantIds.length ||
    execution.groupCount !== groups.size ||
    job.rejectedCount !== 0 ||
    execution.results.some((result) => {
      const row = expected.get(result.rowNumber)
      return (
        !row ||
        (result.outcome !== 'failed' &&
          ((result.outcome === 'updated') !== (row.action === 'update_variant') ||
            (row.productId !== null && result.productId !== row.productId) ||
            (row.variantId !== null && result.variantId !== row.variantId)))
      )
    }) ||
    [...groups.values()].some((group) => {
      const present = group.map((row) => results.get(row)).filter(Boolean)
      return (
        present.length > 0 &&
        (present.length !== group.length ||
          (present.some((row) => row!.outcome === 'failed') && present.some((row) => row!.outcome !== 'failed')) ||
          new Set(present.map((row) => row!.groupIndex)).size !== 1 ||
          new Set(present.filter((row) => row!.outcome !== 'failed').map((row) => row!.productId)).size > 1)
      )
    }) ||
    (execution.state !== 'running' && execution.results.length !== job.rowCount)
  )
    throw new Error('Import results do not reconcile with the original preview.')
  return execution
}
