import {
  wholesaleOrderCancelResponseSchema,
  wholesaleOrderConfirmResponseSchema,
  wholesaleOrderContextSchema,
  wholesaleOrderDraftResponseSchema,
  wholesaleOrderFulfillResponseSchema,
  type WholesaleOrderCancelResponse,
  type WholesaleOrderConfirmResponse,
  type WholesaleOrderContext,
  type WholesaleOrderDraftRequest,
  type WholesaleOrderDraftResponse,
  type WholesaleOrderFulfillRequest,
  type WholesaleOrderFulfillResponse,
} from '@hcs/contracts'
import { Client } from 'pg'

import type { Bindings } from './env'

export type WholesaleOrderContextLoader = (
  userId: string,
  tenantId: string,
  bindings: Bindings,
) => Promise<WholesaleOrderContext>

export type WholesaleOrderDraftSaver = (
  userId: string,
  tenantId: string,
  request: WholesaleOrderDraftRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<WholesaleOrderDraftResponse>

export type WholesaleOrderConfirmer = (
  userId: string,
  tenantId: string,
  salesOrderId: string,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
  creditOverrideId?: string,
) => Promise<WholesaleOrderConfirmResponse>

export type WholesaleOrderCanceller = (
  userId: string,
  tenantId: string,
  salesOrderId: string,
  reason: string,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<WholesaleOrderCancelResponse>

export type WholesaleOrderFulfiller = (
  userId: string,
  tenantId: string,
  salesOrderId: string,
  request: WholesaleOrderFulfillRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<WholesaleOrderFulfillResponse>

function connectionString(bindings: Bindings): string {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  return bindings.HYPERDRIVE.connectionString
}

async function queryFunction<T>(bindings: Bindings, text: string, values: unknown[], parse: (value: unknown) => T) {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(text, values)
    return parse(result.rows[0]?.response ?? result.rows[0]?.context)
  } finally {
    await client.end()
  }
}

export const loadWholesaleOrderContextFromPostgres: WholesaleOrderContextLoader = async (
  userId,
  tenantId,
  bindings,
) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(
      'select app.load_wholesale_order_context($1::uuid, $2::uuid) context, app.list_wholesale_invoices($1::uuid, $2::uuid) invoices',
      [userId, tenantId],
    )
    return wholesaleOrderContextSchema.parse({
      ...(result.rows[0]?.context as Record<string, unknown>),
      invoices: result.rows[0]?.invoices ?? [],
    })
  } finally {
    await client.end()
  }
}

export const saveWholesaleOrderDraftInPostgres: WholesaleOrderDraftSaver = (
  userId,
  tenantId,
  request,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) =>
  queryFunction(
    bindings,
    'select app.save_wholesale_order_draft($1::uuid, $2::uuid, $3::jsonb, $4::text, $5::text, $6::text) response',
    [userId, tenantId, JSON.stringify(request), idempotencyKey, requestHash, requestId],
    (value) => wholesaleOrderDraftResponseSchema.parse(value),
  )

export const confirmWholesaleOrderInPostgres: WholesaleOrderConfirmer = (
  userId,
  tenantId,
  salesOrderId,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
  creditOverrideId,
) =>
  queryFunction(
    bindings,
    creditOverrideId
      ? 'select app.confirm_wholesale_order_with_credit_override($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::uuid) response'
      : 'select app.confirm_wholesale_order($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text) response',
    [
      userId,
      tenantId,
      salesOrderId,
      idempotencyKey,
      requestHash,
      requestId,
      ...(creditOverrideId ? [creditOverrideId] : []),
    ],
    (value) => wholesaleOrderConfirmResponseSchema.parse(value),
  )

export const cancelWholesaleOrderInPostgres: WholesaleOrderCanceller = (
  userId,
  tenantId,
  salesOrderId,
  reason,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) =>
  queryFunction(
    bindings,
    'select app.cancel_wholesale_order_remaining($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text) response',
    [userId, tenantId, salesOrderId, reason, idempotencyKey, requestHash, requestId],
    (value) => wholesaleOrderCancelResponseSchema.parse(value),
  )

export const fulfillWholesaleOrderInPostgres: WholesaleOrderFulfiller = (
  userId,
  tenantId,
  salesOrderId,
  request,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) =>
  queryFunction(
    bindings,
    request.creditOverrideId
      ? 'select app.fulfill_wholesale_order_with_credit_override($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::text, $7::text, $8::uuid) response'
      : 'select app.fulfill_wholesale_order($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::text, $7::text) response',
    [
      userId,
      tenantId,
      salesOrderId,
      JSON.stringify(request.lines),
      idempotencyKey,
      requestHash,
      requestId,
      ...(request.creditOverrideId ? [request.creditOverrideId] : []),
    ],
    (value) => wholesaleOrderFulfillResponseSchema.parse(value),
  )
