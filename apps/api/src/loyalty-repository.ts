import {
  loyaltyContextSchema,
  loyaltyPolicyUpdateResponseSchema,
  type LoyaltyContext,
  type LoyaltyPolicyUpdateRequest,
} from '@hcs/contracts'
import { Client } from 'pg'
import type { Bindings } from './env'

export type LoyaltyLoader = (userId: string, tenantId: string, bindings: Bindings) => Promise<LoyaltyContext>
export type LoyaltyPolicyUpdater = (
  userId: string,
  tenantId: string,
  request: LoyaltyPolicyUpdateRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<unknown>

async function query(bindings: Bindings, text: string, values: unknown[]) {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  const client = new Client({ connectionString: bindings.HYPERDRIVE.connectionString })
  try {
    await client.connect()
    return await client.query(text, values)
  } finally {
    await client.end()
  }
}

export const loadLoyaltyFromPostgres: LoyaltyLoader = async (userId, tenantId, bindings) =>
  loyaltyContextSchema.parse(
    (await query(bindings, 'select app.load_loyalty($1::uuid,$2::uuid) context', [userId, tenantId])).rows[0]?.context,
  )

export const updateLoyaltyPolicyInPostgres: LoyaltyPolicyUpdater = async (
  userId,
  tenantId,
  request,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) =>
  loyaltyPolicyUpdateResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.update_loyalty_policy($1::uuid,$2::uuid,$3::boolean,$4::bigint,$5::text,$6::text,$7::text) response',
        [userId, tenantId, request.enabled, request.spendPerPointCentavos, idempotencyKey, requestHash, requestId],
      )
    ).rows[0]?.response,
  )
