import {
  posCashSaleCompleteResponseSchema,
  posRegisterOpenResponseSchema,
  posSalesContextSchema,
  salesContextSchema,
  type PosCashSaleCompleteRequest,
  type PosCashSaleCompleteResponse,
  type PosRegisterOpenRequest,
  type PosRegisterOpenResponse,
  type PosSalesContext,
  type SalesContext,
} from '@hcs/contracts'
import { Client } from 'pg'
import type { Bindings } from './env'

export type PosSalesContextLoader = (sessionTokenHash: string, bindings: Bindings) => Promise<PosSalesContext>
export type PosRegisterSessionOpener = (
  sessionTokenHash: string,
  request: PosRegisterOpenRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<PosRegisterOpenResponse>
export type PosCashSaleCompleter = (
  sessionTokenHash: string,
  request: PosCashSaleCompleteRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<PosCashSaleCompleteResponse>
export type SalesLoader = (userId: string, tenantId: string, bindings: Bindings) => Promise<SalesContext>

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

export const loadPosSalesContextFromPostgres: PosSalesContextLoader = async (sessionTokenHash, bindings) =>
  posSalesContextSchema.parse(
    (await query(bindings, 'select app.load_pos_sales_context($1::text) context', [sessionTokenHash])).rows[0]?.context,
  )

export const openPosRegisterSessionInPostgres: PosRegisterSessionOpener = async (
  sessionTokenHash,
  request,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) =>
  posRegisterOpenResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.open_pos_register_session($1::text,$2::bigint,$3::text,$4::text,$5::text) response',
        [sessionTokenHash, request.openingCashCentavos, idempotencyKey, requestHash, requestId],
      )
    ).rows[0]?.response,
  )

export const completePosCashSaleInPostgres: PosCashSaleCompleter = async (
  sessionTokenHash,
  request,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) =>
  posCashSaleCompleteResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.complete_pos_cash_sale($1::text,$2::jsonb,$3::bigint,$4::text,$5::text,$6::text) response',
        [
          sessionTokenHash,
          JSON.stringify(request.lines),
          request.cashReceivedCentavos,
          idempotencyKey,
          requestHash,
          requestId,
        ],
      )
    ).rows[0]?.response,
  )

export const loadSalesFromPostgres: SalesLoader = async (userId, tenantId, bindings) =>
  salesContextSchema.parse(
    (await query(bindings, 'select app.list_sales($1::uuid,$2::uuid,$3::integer) context', [userId, tenantId, 100]))
      .rows[0]?.context,
  )
