import {
  wholesaleReturnResponseSchema,
  wholesaleCreditApplyResponseSchema,
  wholesaleCreditRefundResponseSchema,
  wholesaleReturnsContextSchema,
  type WholesaleReturnRequest,
  type WholesaleReturnResponse,
  type WholesaleCreditApplyRequest,
  type WholesaleCreditApplyResponse,
  type WholesaleCreditRefundRequest,
  type WholesaleCreditRefundResponse,
  type WholesaleReturnsContext,
} from '@hcs/contracts'
import { Client } from 'pg'
import type { Bindings } from './env'

async function query<T>(bindings: Bindings, sql: string, values: unknown[], parse: (value: unknown) => T): Promise<T> {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  const client = new Client({ connectionString: bindings.HYPERDRIVE.connectionString })
  try {
    await client.connect()
    const result = await client.query(sql, values)
    return parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}
type Command<Request, Response> = (
  userId: string,
  tenantId: string,
  request: Request,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<Response>
export type WholesaleReturnsLoader = (
  userId: string,
  tenantId: string,
  bindings: Bindings,
) => Promise<WholesaleReturnsContext>
export type WholesaleReturnPoster = Command<WholesaleReturnRequest, WholesaleReturnResponse>
export type WholesaleCreditApplier = Command<WholesaleCreditApplyRequest, WholesaleCreditApplyResponse>
export type WholesaleCreditRefunder = Command<WholesaleCreditRefundRequest, WholesaleCreditRefundResponse>
export const loadWholesaleReturnsFromPostgres: WholesaleReturnsLoader = (user, tenant, bindings) =>
  query(bindings, 'select app.load_wholesale_returns($1::uuid,$2::uuid) response', [user, tenant], (value) =>
    wholesaleReturnsContextSchema.parse(value),
  )
export const postWholesaleReturnInPostgres: WholesaleReturnPoster = (
  user,
  tenant,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  query(
    bindings,
    'select app.post_wholesale_return($1::uuid,$2::uuid,$3::jsonb,$4::text,$5::text,$6::text) response',
    [user, tenant, JSON.stringify(request), key, hash, requestId],
    (value) => wholesaleReturnResponseSchema.parse(value),
  )
export const applyWholesaleCreditInPostgres: WholesaleCreditApplier = (
  user,
  tenant,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  query(
    bindings,
    "select app.command_wholesale_credit($1::uuid,$2::uuid,'apply',$3::jsonb,$4::text,$5::text,$6::text) response",
    [user, tenant, JSON.stringify(request), key, hash, requestId],
    (value) => wholesaleCreditApplyResponseSchema.parse(value),
  )
export const refundWholesaleCreditInPostgres: WholesaleCreditRefunder = (
  user,
  tenant,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  query(
    bindings,
    "select app.command_wholesale_credit($1::uuid,$2::uuid,'refund',$3::jsonb,$4::text,$5::text,$6::text) response",
    [user, tenant, JSON.stringify(request), key, hash, requestId],
    (value) => wholesaleCreditRefundResponseSchema.parse(value),
  )
