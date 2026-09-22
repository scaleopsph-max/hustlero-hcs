import {
  tenantBootstrapResponseSchema,
  type TenantBootstrapRequest,
  type TenantBootstrapResponse,
} from '@hcs/contracts'
import { Client } from 'pg'

import type { Bindings } from './env'

export type TenantBootstrapper = (
  userId: string,
  request: TenantBootstrapRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<TenantBootstrapResponse>

export type ActiveLocationCounter = (tenantId: string, bindings: Bindings) => Promise<number>

function connectionString(bindings: Bindings): string {
  if (!bindings.HYPERDRIVE?.connectionString) {
    throw new Error('HYPERDRIVE binding is not configured.')
  }

  return bindings.HYPERDRIVE.connectionString
}

export const bootstrapTenantInPostgres: TenantBootstrapper = async (
  userId,
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
      `select app.bootstrap_tenant(
        $1::uuid, $2::text, $3::text, $4::text, $5::text,
        $6::text, $7::text, $8::text, $9::text, $10::text
      ) as response`,
      [
        userId,
        request.slug,
        request.name,
        request.baseCurrency,
        request.timezone,
        request.mainLocation.code,
        request.mainLocation.name,
        idempotencyKey,
        requestHash,
        requestId,
      ],
    )

    return tenantBootstrapResponseSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}

export const countActiveLocationsInPostgres: ActiveLocationCounter = async (tenantId, bindings) => {
  const client = new Client({ connectionString: connectionString(bindings) })

  try {
    await client.connect()
    const result = await client.query(
      'select count(*)::integer as count from app.locations where tenant_id = $1::uuid and is_active',
      [tenantId],
    )

    return Number(result.rows[0]?.count ?? 0)
  } finally {
    await client.end()
  }
}
