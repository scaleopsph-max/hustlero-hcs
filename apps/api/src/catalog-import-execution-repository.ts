import { Client } from 'pg'
import {
  catalogImportReviewDataSchema,
  catalogImportExecutionResponseSchema,
  type CatalogImportExecutionCommand,
} from '@hcs/contracts'
import type { Bindings } from './env'
export type CatalogImportReviewer = (
  actor: string,
  tenant: string,
  job: string,
  bindings: Bindings,
) => Promise<ReturnType<typeof catalogImportReviewDataSchema.parse>>
export type CatalogImportExecutionLoader = (
  actor: string,
  tenant: string,
  job: string,
  bindings: Bindings,
) => Promise<ReturnType<typeof catalogImportExecutionResponseSchema.parse>>
export type CatalogImportExecutor = (
  actor: string,
  tenant: string,
  job: string,
  command: CatalogImportExecutionCommand,
  key: string | null,
  request: string,
  bindings: Bindings,
) => Promise<ReturnType<typeof catalogImportExecutionResponseSchema.parse>>
async function query(bindings: Bindings, sql: string, params: unknown[]) {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  const client = new Client({ connectionString: bindings.HYPERDRIVE.connectionString })
  try {
    await client.connect()
    return (await client.query(sql, params)).rows[0]?.response as unknown
  } finally {
    await client.end()
  }
}
export const reviewCatalogImportFromPostgres: CatalogImportReviewer = async (actor, tenant, job, bindings) =>
  catalogImportReviewDataSchema.parse(
    await query(bindings, 'select app.review_catalog_import($1::uuid,$2::uuid,$3::uuid) response', [
      actor,
      tenant,
      job,
    ]),
  )
export const loadCatalogImportExecutionFromPostgres: CatalogImportExecutionLoader = async (
  actor,
  tenant,
  job,
  bindings,
) =>
  catalogImportExecutionResponseSchema.parse(
    await query(bindings, 'select app.load_catalog_import_execution($1::uuid,$2::uuid,$3::uuid) response', [
      actor,
      tenant,
      job,
    ]),
  )
export const executeCatalogImportInPostgres: CatalogImportExecutor = async (
  actor,
  tenant,
  job,
  command,
  key,
  request,
  bindings,
) =>
  catalogImportExecutionResponseSchema.parse(
    await query(
      bindings,
      command.action === 'start'
        ? 'select app.start_catalog_import($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text) response'
        : 'select app.process_catalog_import_group($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::text) response',
      command.action === 'start'
        ? [actor, tenant, job, command.reviewHash, key, request]
        : [actor, tenant, job, command.groupIndex, request],
    ),
  )
