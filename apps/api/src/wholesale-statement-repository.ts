import { Client } from 'pg'
import { wholesaleStatementSchema, type WholesaleStatement, type WholesaleStatementQuery } from '@hcs/contracts'
import type { Bindings } from './env'
export type WholesaleStatementLoader = (
  userId: string,
  tenantId: string,
  query: WholesaleStatementQuery,
  bindings: Bindings,
) => Promise<WholesaleStatement>
export const loadWholesaleStatementFromPostgres: WholesaleStatementLoader = async (
  userId,
  tenantId,
  query,
  bindings,
) => {
  const connectionString = bindings.HYPERDRIVE?.connectionString
  if (!connectionString) throw new Error('Database connection is not configured.')
  const client = new Client({ connectionString })
  try {
    await client.connect()
    const result = await client.query(
      'select app.load_wholesale_statement($1::uuid,$2::uuid,$3::date,$4::uuid,$5::uuid) response',
      [userId, tenantId, query.asOf, query.customerId ?? null, query.locationId ?? null],
    )
    return wholesaleStatementSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}
