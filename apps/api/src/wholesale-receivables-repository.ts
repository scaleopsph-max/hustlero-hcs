import {
  wholesalePaymentsContextSchema,
  type WholesalePaymentsContext,
  wholesalePaymentAllocationResponseSchema,
  type WholesalePaymentAllocationResponse,
  type WholesalePaymentAllocationRequest,
  wholesaleCreditOverridesContextSchema,
  wholesaleCreditOverrideCommandResponseSchema,
  type WholesaleCreditOverrideApprove,
  type WholesaleCreditOverridesContext,
  type WholesaleCreditOverrideCommandResponse,
  wholesaleCreditSettingsContextSchema,
  wholesaleCreditSettingsResponseSchema,
  type WholesaleCreditSettingsContext,
  type WholesaleCreditSettingsRequest,
  type WholesaleCreditSettingsResponse,
  wholesaleOpeningReceivableResponseSchema,
  wholesaleReceivablesContextSchema,
  type WholesaleOpeningReceivableRequest,
  type WholesaleOpeningReceivableResponse,
  type WholesaleReceivablesContext,
} from '@hcs/contracts'
import { Client } from 'pg'

import type { Bindings } from './env'

export type WholesalePaymentsLoader = (
  userId: string,
  tenantId: string,
  bindings: Bindings,
) => Promise<WholesalePaymentsContext>
export const loadWholesalePaymentsFromPostgres: WholesalePaymentsLoader = (userId, tenantId, bindings) =>
  query(bindings, 'select app.load_wholesale_payments($1::uuid,$2::uuid) response', [userId, tenantId], (value) =>
    wholesalePaymentsContextSchema.parse(value),
  )

export type WholesalePaymentRecorder = (
  userId: string,
  tenantId: string,
  request: WholesalePaymentAllocationRequest,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<WholesalePaymentAllocationResponse>
export const recordWholesalePaymentInPostgres: WholesalePaymentRecorder = (
  userId,
  tenantId,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  query(
    bindings,
    'select app.record_wholesale_payment($1::uuid,$2::uuid,$3::jsonb,$4::text,$5::text,$6::text) response',
    [userId, tenantId, JSON.stringify(request), key, hash, requestId],
    (value) => wholesalePaymentAllocationResponseSchema.parse(value),
  )

export type WholesaleCreditOverridesLoader = (
  userId: string,
  tenantId: string,
  bindings: Bindings,
) => Promise<WholesaleCreditOverridesContext>
export type WholesaleCreditOverrideCommander = (
  userId: string,
  tenantId: string,
  operation: 'approve' | 'revoke',
  request: WholesaleCreditOverrideApprove | { overrideId: string; reason: string },
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<WholesaleCreditOverrideCommandResponse>
export const loadWholesaleCreditOverridesFromPostgres: WholesaleCreditOverridesLoader = (userId, tenantId, bindings) =>
  query(
    bindings,
    'select app.load_wholesale_credit_overrides($1::uuid,$2::uuid) response',
    [userId, tenantId],
    (value) => wholesaleCreditOverridesContextSchema.parse(value),
  )
export const commandWholesaleCreditOverrideInPostgres: WholesaleCreditOverrideCommander = (
  userId,
  tenantId,
  operation,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  query(
    bindings,
    'select app.command_wholesale_credit_override($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text,$6::text,$7::text) response',
    [userId, tenantId, operation, JSON.stringify(request), key, hash, requestId],
    (value) => wholesaleCreditOverrideCommandResponseSchema.parse(value),
  )

export type WholesaleCreditSettingsLoader = (
  userId: string,
  tenantId: string,
  bindings: Bindings,
) => Promise<WholesaleCreditSettingsContext>
export type WholesaleCreditSettingsSaver = (
  userId: string,
  tenantId: string,
  request: WholesaleCreditSettingsRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<WholesaleCreditSettingsResponse>

export const loadWholesaleCreditSettingsFromPostgres: WholesaleCreditSettingsLoader = (userId, tenantId, bindings) =>
  query(
    bindings,
    'select app.load_wholesale_customer_credit_settings($1::uuid, $2::uuid) response',
    [userId, tenantId],
    (value) => wholesaleCreditSettingsContextSchema.parse(value),
  )

export const saveWholesaleCreditSettingsInPostgres: WholesaleCreditSettingsSaver = (
  userId,
  tenantId,
  request,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) =>
  query(
    bindings,
    'select app.save_wholesale_customer_credit_settings($1::uuid, $2::uuid, $3::jsonb, $4::text, $5::text, $6::text) response',
    [userId, tenantId, JSON.stringify(request), idempotencyKey, requestHash, requestId],
    (value) => wholesaleCreditSettingsResponseSchema.parse(value),
  )

export type WholesaleReceivablesLoader = (
  userId: string,
  tenantId: string,
  bindings: Bindings,
) => Promise<WholesaleReceivablesContext>
export type WholesaleOpeningReceivableRecorder = (
  userId: string,
  tenantId: string,
  request: WholesaleOpeningReceivableRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<WholesaleOpeningReceivableResponse>

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

export const loadWholesaleReceivablesFromPostgres: WholesaleReceivablesLoader = (userId, tenantId, bindings) =>
  query(bindings, 'select app.load_wholesale_receivables($1::uuid, $2::uuid) response', [userId, tenantId], (value) =>
    wholesaleReceivablesContextSchema.parse(value),
  )

export const recordWholesaleOpeningReceivableInPostgres: WholesaleOpeningReceivableRecorder = (
  userId,
  tenantId,
  request,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) =>
  query(
    bindings,
    'select app.record_wholesale_opening_receivable($1::uuid, $2::uuid, $3::jsonb, $4::text, $5::text, $6::text) response',
    [userId, tenantId, JSON.stringify(request), idempotencyKey, requestHash, requestId],
    (value) => wholesaleOpeningReceivableResponseSchema.parse(value),
  )
