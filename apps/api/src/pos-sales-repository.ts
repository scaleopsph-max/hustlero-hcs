import {
  posCashSaleCompleteResponseSchema,
  posRegisterOpenResponseSchema,
  posSalesContextSchema,
  salesContextSchema,
  saleReceiptDetailSchema,
  saleReversalResponseSchema,
  type PosCashSaleCompleteRequest,
  type PosCashSaleCompleteResponse,
  type PosRegisterOpenRequest,
  type PosRegisterOpenResponse,
  type PosSalesContext,
  type SalesContext,
  type SaleReceiptDetail,
  type SaleRefundRequest,
  type SaleVoidRequest,
  type SaleReversalResponse,
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
export type SaleReceiptLoader = (
  userId: string,
  tenantId: string,
  saleId: string,
  bindings: Bindings,
) => Promise<SaleReceiptDetail>
export type SaleRefunder = (
  userId: string,
  tenantId: string,
  saleId: string,
  request: SaleRefundRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<SaleReversalResponse>
export type SaleVoider = (
  userId: string,
  tenantId: string,
  saleId: string,
  request: SaleVoidRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<SaleReversalResponse>

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

export const loadSaleReceiptFromPostgres: SaleReceiptLoader = async (userId, tenantId, saleId, bindings) =>
  saleReceiptDetailSchema.parse(
    (
      await query(bindings, 'select app.load_sale_receipt($1::uuid,$2::uuid,$3::uuid) receipt', [
        userId,
        tenantId,
        saleId,
      ])
    ).rows[0]?.receipt,
  )

export const refundSaleInPostgres: SaleRefunder = async (
  userId,
  tenantId,
  saleId,
  request,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) =>
  saleReversalResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.reverse_sale($1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::text,$7::text,$8::text,$9::text) response',
        [
          userId,
          tenantId,
          saleId,
          'refund',
          JSON.stringify(request.lines),
          request.reason,
          idempotencyKey,
          requestHash,
          requestId,
        ],
      )
    ).rows[0]?.response,
  )

export const voidSaleInPostgres: SaleVoider = async (
  userId,
  tenantId,
  saleId,
  request,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) =>
  saleReversalResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.reverse_sale($1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::text,$7::text,$8::text,$9::text) response',
        [userId, tenantId, saleId, 'void', null, request.reason, idempotencyKey, requestHash, requestId],
      )
    ).rows[0]?.response,
  )
