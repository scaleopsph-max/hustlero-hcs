import { z } from 'zod'
import { catalogImportJobSchema, catalogImportSnapshotSchema } from './catalog-import'
const id = z.uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/)
export const catalogImportReviewDataSchema = z.object({
  hash,
  groupCount: z.number().int().min(1).max(5000),
  job: catalogImportJobSchema,
  snapshot: catalogImportSnapshotSchema,
})
export const catalogImportReviewSchema = z.object({ hash, jobId: id, groupCount: z.number().int().min(1).max(5000) })
export const catalogImportExecutionCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('start'), reviewHash: hash }),
  z.strictObject({ action: z.literal('step'), groupIndex: z.number().int().min(0).max(4999) }),
])
export const catalogImportExecutionSchema = z
  .object({
    id,
    jobId: id,
    state: z.enum(['running', 'completed', 'completed_with_errors']),
    groupCount: z.number().int().min(1).max(5000),
    nextGroup: z.number().int().min(0).max(5000),
    confirmedBy: id,
    requestKey: z.string().min(16).max(128),
    reviewHash: hash,
    confirmedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    results: z
      .array(
        z.object({
          groupIndex: z.number().int().min(0).max(4999),
          rowNumber: z.number().int().min(2).max(5001),
          outcome: z.enum(['created', 'updated', 'failed']),
          productId: id.nullable(),
          variantId: id.nullable(),
          errorCode: z.string().nullable(),
          recordedAt: z.iso.datetime({ offset: true }),
        }),
      )
      .max(5000),
  })
  .superRefine((execution, context) => {
    const groups = new Set(execution.results.map((row) => row.groupIndex))
    if (
      execution.nextGroup > execution.groupCount ||
      groups.size !== execution.nextGroup ||
      new Set(execution.results.map((row) => row.rowNumber)).size !== execution.results.length ||
      execution.results.some(
        (row) =>
          row.groupIndex >= execution.nextGroup ||
          (row.outcome === 'failed'
            ? !row.errorCode || row.productId !== null || row.variantId !== null
            : row.errorCode !== null || !row.productId || !row.variantId),
      ) ||
      (execution.state === 'running') !== execution.nextGroup < execution.groupCount ||
      (execution.state === 'running') !== (execution.completedAt === null) ||
      (execution.state === 'completed' && execution.results.some((row) => row.outcome === 'failed')) ||
      (execution.state === 'completed_with_errors' && !execution.results.some((row) => row.outcome === 'failed'))
    )
      context.addIssue({ code: 'custom', message: 'Import execution does not reconcile.' })
  })
export const catalogImportExecutionResponseSchema = z.object({ execution: catalogImportExecutionSchema.nullable() })
export type CatalogImportExecution = z.infer<typeof catalogImportExecutionSchema>
export type CatalogImportExecutionCommand = z.infer<typeof catalogImportExecutionCommandSchema>
export type CatalogImportReview = z.infer<typeof catalogImportReviewSchema>
