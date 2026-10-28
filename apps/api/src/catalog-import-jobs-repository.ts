import { Client } from 'pg'
import {
  catalogImportJobSchema,
  catalogImportJobListSchema,
  catalogImportJobSavedSchema,
  type CatalogImportPreviewRequest,
  type CatalogImportPreviewResponse,
  type CatalogImportJob,
  type CatalogImportJobList,
  type CatalogImportJobSaved,
} from '@hcs/contracts'
import type { Bindings } from './env'

export type CatalogImportJobSaver = (
  actor: string,
  tenant: string,
  raw: CatalogImportPreviewRequest,
  rows: CatalogImportPreviewResponse['rows'],
  key: string,
  requestId: string,
  bindings: Bindings,
) => Promise<CatalogImportJobSaved>
export type CatalogImportJobsLoader = (
  actor: string,
  tenant: string,
  bindings: Bindings,
) => Promise<CatalogImportJobList>
export type CatalogImportJobLoader = (
  actor: string,
  tenant: string,
  job: string,
  bindings: Bindings,
) => Promise<CatalogImportJob>
export type CatalogImportJobCanceller = (
  actor: string,
  tenant: string,
  job: string,
  requestId: string,
  bindings: Bindings,
) => Promise<CatalogImportJob>
async function query(bindings: Bindings, sql: string, params: unknown[]) {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  const client = new Client({ connectionString: bindings.HYPERDRIVE.connectionString })
  try {
    await client.connect()
    const result = await client.query(sql, params)
    return result.rows[0]?.response as unknown
  } finally {
    await client.end()
  }
}
export const saveCatalogImportJobInPostgres: CatalogImportJobSaver = async (
  actor,
  tenant,
  raw,
  rows,
  key,
  request,
  bindings,
) =>
  catalogImportJobSavedSchema.parse(
    await query(
      bindings,
      'select app.save_catalog_import_job($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::text,$6::text) response',
      [actor, tenant, JSON.stringify(raw), JSON.stringify(rows), key, request],
    ),
  )
export const loadCatalogImportJobsFromPostgres: CatalogImportJobsLoader = async (actor, tenant, bindings) =>
  catalogImportJobListSchema.parse(
    await query(bindings, 'select app.load_catalog_import_jobs($1::uuid,$2::uuid,null) response', [actor, tenant]),
  )
export const loadCatalogImportJobFromPostgres: CatalogImportJobLoader = async (actor, tenant, job, bindings) =>
  catalogImportJobSchema.parse(
    await query(bindings, 'select app.load_catalog_import_jobs($1::uuid,$2::uuid,$3::uuid) response', [
      actor,
      tenant,
      job,
    ]),
  )
export const cancelCatalogImportJobInPostgres: CatalogImportJobCanceller = async (
  actor,
  tenant,
  job,
  request,
  bindings,
) =>
  catalogImportJobSchema.parse(
    await query(bindings, 'select app.cancel_catalog_import_job($1::uuid,$2::uuid,$3::uuid,$4::text) response', [
      actor,
      tenant,
      job,
      request,
    ]),
  )
