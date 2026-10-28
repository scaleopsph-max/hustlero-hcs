import { Client } from 'pg'
import {
  retailDiscountContextSchema,
  retailDiscountSchema,
  retailDiscountVersionsSchema,
  type RetailDiscount,
  type RetailDiscountCommand,
  type RetailDiscountContext,
  type RetailDiscountVersions,
} from '@hcs/contracts'
import type { Bindings } from './env'

export type RetailDiscountLoader = (
  actor: string,
  tenant: string,
  id: string | null,
  revision: number | null,
  bindings: Bindings,
) => Promise<RetailDiscountContext | RetailDiscountVersions | RetailDiscount>
export type RetailDiscountCommander = (
  actor: string,
  tenant: string,
  body: RetailDiscountCommand,
  key: string,
  requestId: string,
  bindings: Bindings,
) => Promise<RetailDiscount>
async function query(bindings: Bindings, sql: string, values: unknown[]) {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  const client = new Client({ connectionString: bindings.HYPERDRIVE.connectionString })
  try {
    await client.connect()
    return (await client.query(sql, values)).rows[0]?.response as unknown
  } finally {
    await client.end()
  }
}
export const loadRetailDiscountsFromPostgres: RetailDiscountLoader = async (actor, tenant, id, revision, bindings) => {
  const result = await query(
    bindings,
    'select app.load_retail_discounts($1::uuid,$2::uuid,$3::uuid,$4::integer) response',
    [actor, tenant, id, revision],
  )
  return (
    id === null ? retailDiscountContextSchema : revision === null ? retailDiscountVersionsSchema : retailDiscountSchema
  ).parse(result)
}
export const manageRetailDiscountInPostgres: RetailDiscountCommander = async (
  actor,
  tenant,
  body,
  key,
  requestId,
  bindings,
) =>
  retailDiscountSchema.parse(
    await query(bindings, 'select app.manage_retail_discount($1::uuid,$2::uuid,$3::jsonb,$4::text,$5::text) response', [
      actor,
      tenant,
      JSON.stringify(body),
      key,
      requestId,
    ]),
  )
