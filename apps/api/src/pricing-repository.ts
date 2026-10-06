import {
  priceListUpsertResponseSchema,
  pricingContextSchema,
  type PriceListUpsertRequest,
  type PriceListUpsertResponse,
  type PricingContext,
} from '@hcs/contracts'
import { Client } from 'pg'

import type { Bindings } from './env'

export type PricingContextLoader = (userId: string, tenantId: string, bindings: Bindings) => Promise<PricingContext>
export type PriceListUpserter = (
  userId: string,
  tenantId: string,
  request: PriceListUpsertRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<PriceListUpsertResponse>

function connectionString(bindings: Bindings): string {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  return bindings.HYPERDRIVE.connectionString
}

export const loadPricingContextFromPostgres: PricingContextLoader = async (userId, tenantId, bindings) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query('select app.load_pricing_context($1::uuid, $2::uuid) context', [userId, tenantId])
    return pricingContextSchema.parse(result.rows[0]?.context)
  } finally {
    await client.end()
  }
}

export const upsertPriceListInPostgres: PriceListUpserter = async (
  userId,
  tenantId,
  request,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(
      'select app.upsert_price_list($1::uuid, $2::uuid, $3::jsonb, $4::text, $5::text, $6::text) response',
      [userId, tenantId, JSON.stringify(request), idempotencyKey, requestHash, requestId],
    )
    return priceListUpsertResponseSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}
