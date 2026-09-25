import {
  paymentMethodCreateResponseSchema,
  registerOperationsContextSchema,
  registerSessionCloseResponseSchema,
  registerSessionOpenResponseSchema,
  type PaymentMethodCreateRequest,
  type RegisterOperationsContext,
  type RegisterSessionCloseRequest,
  type RegisterSessionOpenRequest,
} from '@hcs/contracts'
import { Client } from 'pg'
import type { Bindings } from './env'

export type RegisterOperationsLoader = (
  userId: string,
  tenantId: string,
  bindings: Bindings,
) => Promise<RegisterOperationsContext>
export type PaymentMethodCreator = (
  userId: string,
  tenantId: string,
  request: PaymentMethodCreateRequest,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<unknown>
export type RegisterSessionOpener = (
  userId: string,
  tenantId: string,
  request: RegisterSessionOpenRequest,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<unknown>
export type RegisterSessionCloser = (
  userId: string,
  tenantId: string,
  sessionId: string,
  request: RegisterSessionCloseRequest,
  key: string,
  hash: string,
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

export const loadRegisterOperationsFromPostgres: RegisterOperationsLoader = async (userId, tenantId, bindings) =>
  registerOperationsContextSchema.parse(
    (await query(bindings, 'select app.list_register_operations($1::uuid,$2::uuid) context', [userId, tenantId]))
      .rows[0]?.context,
  )

export const createPaymentMethodInPostgres: PaymentMethodCreator = async (
  userId,
  tenantId,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  paymentMethodCreateResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.create_payment_method($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text) response',
        [userId, tenantId, request.code, request.name, request.methodType, key, hash, requestId],
      )
    ).rows[0]?.response,
  )

export const openRegisterSessionInPostgres: RegisterSessionOpener = async (
  userId,
  tenantId,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  registerSessionOpenResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.open_register_session($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint,$6::text,$7::text,$8::text) response',
        [userId, tenantId, request.registerId, request.employeeId, request.openingCashCentavos, key, hash, requestId],
      )
    ).rows[0]?.response,
  )

export const closeRegisterSessionInPostgres: RegisterSessionCloser = async (
  userId,
  tenantId,
  sessionId,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  registerSessionCloseResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.close_register_session($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text,$6::text,$7::text) response',
        [userId, tenantId, sessionId, request.countedCashCentavos, key, hash, requestId],
      )
    ).rows[0]?.response,
  )
