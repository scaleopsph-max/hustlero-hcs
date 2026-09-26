import {
  platformContextSchema,
  platformEntitlementUpdateResponseSchema,
  platformTenantStatusUpdateResponseSchema,
  supportAccessContextSchema,
  supportAccessGrantSchema,
  supportAccessOverviewSchema,
  type PlatformContext,
  type PlatformEntitlementUpdateRequest,
  type PlatformEntitlementUpdateResponse,
  type PlatformTenantStatusUpdateRequest,
  type PlatformTenantStatusUpdateResponse,
  type SupportAccessContext,
  type SupportAccessCreateRequest,
  type SupportAccessGrant,
  type SupportAccessOverview,
  type SupportAccessRevokeRequest,
} from '@hcs/contracts'
import { Client } from 'pg'

import type { Bindings } from './env'

export type PlatformContextLoader = (userId: string, bindings: Bindings) => Promise<PlatformContext>
export type PlatformEntitlementUpdater = (
  userId: string,
  tenantId: string,
  featureCode: string,
  request: PlatformEntitlementUpdateRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<PlatformEntitlementUpdateResponse>
export type PlatformTenantStatusUpdater = (
  userId: string,
  tenantId: string,
  request: PlatformTenantStatusUpdateRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<PlatformTenantStatusUpdateResponse>
export type SupportAccessLoader = (userId: string, bindings: Bindings) => Promise<SupportAccessContext>
export type SupportAccessCreator = (
  userId: string,
  request: SupportAccessCreateRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<SupportAccessGrant>
export type SupportAccessRevoker = (
  userId: string,
  grantId: string,
  request: SupportAccessRevokeRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<SupportAccessGrant>
export type SupportOverviewLoader = (
  userId: string,
  grantId: string,
  requestId: string,
  bindings: Bindings,
) => Promise<SupportAccessOverview>

function connectionString(bindings: Bindings) {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  return bindings.HYPERDRIVE.connectionString
}

export const loadPlatformContextFromPostgres: PlatformContextLoader = async (userId, bindings) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query('select platform.load_context($1::uuid) context', [userId])
    return platformContextSchema.parse(result.rows[0]?.context)
  } finally {
    await client.end()
  }
}

export const updatePlatformEntitlementInPostgres: PlatformEntitlementUpdater = async (
  userId,
  tenantId,
  featureCode,
  request,
  idempotencyKey,
  hash,
  requestId,
  bindings,
) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(
      'select platform.update_tenant_entitlement($1::uuid,$2::uuid,$3::text,$4::boolean,$5::timestamptz,$6::text,$7::text,$8::text,$9::text) response',
      [
        userId,
        tenantId,
        featureCode,
        request.entitled,
        request.endsAt,
        request.reason,
        idempotencyKey,
        hash,
        requestId,
      ],
    )
    return platformEntitlementUpdateResponseSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}

export const updatePlatformTenantStatusInPostgres: PlatformTenantStatusUpdater = async (
  userId,
  tenantId,
  request,
  idempotencyKey,
  hash,
  requestId,
  bindings,
) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(
      'select platform.update_tenant_status($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text) response',
      [userId, tenantId, request.status, request.reason, idempotencyKey, hash, requestId],
    )
    return platformTenantStatusUpdateResponseSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}

export const loadSupportAccessFromPostgres: SupportAccessLoader = async (userId, bindings) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query('select platform.load_support_access($1::uuid) context', [userId])
    return supportAccessContextSchema.parse(result.rows[0]?.context)
  } finally {
    await client.end()
  }
}

export const createSupportAccessInPostgres: SupportAccessCreator = async (
  userId,
  request,
  idempotencyKey,
  hash,
  requestId,
  bindings,
) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(
      'select platform.create_support_access($1::uuid,$2::uuid,$3::text,$4::text,$5::integer,$6::text,$7::text,$8::text) response',
      [
        userId,
        request.tenantId,
        request.ticketReference,
        request.reason,
        request.durationMinutes,
        idempotencyKey,
        hash,
        requestId,
      ],
    )
    return supportAccessGrantSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}

export const revokeSupportAccessInPostgres: SupportAccessRevoker = async (
  userId,
  grantId,
  request,
  idempotencyKey,
  hash,
  requestId,
  bindings,
) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(
      'select platform.revoke_support_access($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text) response',
      [userId, grantId, request.reason, idempotencyKey, hash, requestId],
    )
    return supportAccessGrantSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}

export const loadSupportOverviewFromPostgres: SupportOverviewLoader = async (userId, grantId, requestId, bindings) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query('select platform.load_support_overview($1::uuid,$2::uuid,$3::text) overview', [
      userId,
      grantId,
      requestId,
    ])
    return supportAccessOverviewSchema.parse(result.rows[0]?.overview)
  } finally {
    await client.end()
  }
}
