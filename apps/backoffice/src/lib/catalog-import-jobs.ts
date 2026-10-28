import { z } from 'zod'
import { catalogImportPreviewRequestSchema, catalogImportJobSchema, catalogImportJobSavedSchema } from '@hcs/contracts'
export const pendingImportSaveSchema = z.strictObject({ key: z.uuid(), payload: catalogImportPreviewRequestSchema })
export type PendingImportSave = z.infer<typeof pendingImportSaveSchema>
export function restoreImportSave(value: string | null) {
  return value === null ? null : pendingImportSaveSchema.parse(JSON.parse(value))
}
export function reconcileImportSave(command: PendingImportSave, value: unknown, detail: unknown) {
  const saved = catalogImportJobSavedSchema.parse(value),
    job = catalogImportJobSchema.parse(detail)
  if (saved.jobId !== job.id || JSON.stringify(command.payload) !== JSON.stringify(job.source))
    throw new Error('Import job could not be reconciled. Retry the original save.')
  return job
}
export function sameImportSave(a: PendingImportSave, b: PendingImportSave | null) {
  return b !== null && a.key === b.key && JSON.stringify(a.payload) === JSON.stringify(b.payload)
}
