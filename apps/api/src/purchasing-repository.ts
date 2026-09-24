import {
  purchaseOrderCreateResponseSchema,
  purchaseOrderSendResponseSchema,
  purchaseReceiptResponseSchema,
  purchasingContextSchema,
  supplierCreateResponseSchema,
  type PurchaseOrderCreateRequest,
  type PurchaseOrderSendResponse,
  type PurchaseReceiptRequest,
  type PurchaseReceiptResponse,
  type PurchasingContext,
  type SupplierCreateRequest,
  type SupplierCreateResponse,
} from '@hcs/contracts'
import { Client } from 'pg'
import type { Bindings } from './env'

export type PurchasingLoader = (userId: string, tenantId: string, bindings: Bindings) => Promise<PurchasingContext>
export type SupplierCreator = (
  userId: string,
  tenantId: string,
  request: SupplierCreateRequest,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<SupplierCreateResponse>
export type PurchaseOrderCreator = (
  userId: string,
  tenantId: string,
  request: PurchaseOrderCreateRequest,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<{ purchaseOrderId: string; status: 'draft'; lineCount: number }>
export type PurchaseOrderSender = (
  userId: string,
  tenantId: string,
  id: string,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<PurchaseOrderSendResponse>
export type PurchaseOrderReceiver = (
  userId: string,
  tenantId: string,
  id: string,
  request: PurchaseReceiptRequest,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<PurchaseReceiptResponse>

function connectionString(bindings: Bindings): string {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  return bindings.HYPERDRIVE.connectionString
}
async function query(bindings: Bindings, text: string, values: unknown[]) {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    return await client.query(text, values)
  } finally {
    await client.end()
  }
}

export const loadPurchasingFromPostgres: PurchasingLoader = async (userId, tenantId, bindings) => {
  const result = await query(bindings, 'select app.list_purchasing_context($1::uuid,$2::uuid) as context', [
    userId,
    tenantId,
  ])
  return purchasingContextSchema.parse(result.rows[0]?.context)
}
export const createSupplierInPostgres: SupplierCreator = async (
  userId,
  tenantId,
  request,
  key,
  hash,
  requestId,
  bindings,
) => {
  const result = await query(
    bindings,
    'select app.create_supplier($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text) as response',
    [
      userId,
      tenantId,
      request.name,
      request.contactName,
      request.contactPhone,
      request.contactEmail,
      key,
      hash,
      requestId,
    ],
  )
  return supplierCreateResponseSchema.parse(result.rows[0]?.response)
}
export const createPurchaseOrderInPostgres: PurchaseOrderCreator = async (
  userId,
  tenantId,
  request,
  key,
  hash,
  requestId,
  bindings,
) => {
  const lines = request.lines.map((line) => ({
    variantId: line.variantId,
    quantityMilli: line.quantityMilli,
    unitCostMinor: line.unitCostMinor,
  }))
  const result = await query(
    bindings,
    'select app.create_purchase_order($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::timestamptz,$7::text,$8::jsonb,$9::text,$10::text,$11::text) as response',
    [
      userId,
      tenantId,
      request.supplierId,
      request.locationId,
      request.orderNumber,
      request.expectedAt,
      request.notes,
      JSON.stringify(lines),
      key,
      hash,
      requestId,
    ],
  )
  return purchaseOrderCreateResponseSchema.parse(result.rows[0]?.response)
}
export const sendPurchaseOrderInPostgres: PurchaseOrderSender = async (
  userId,
  tenantId,
  id,
  key,
  hash,
  requestId,
  bindings,
) => {
  const result = await query(
    bindings,
    'select app.send_purchase_order($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text) as response',
    [userId, tenantId, id, key, hash, requestId],
  )
  return purchaseOrderSendResponseSchema.parse(result.rows[0]?.response)
}
export const receivePurchaseOrderInPostgres: PurchaseOrderReceiver = async (
  userId,
  tenantId,
  id,
  request,
  key,
  hash,
  requestId,
  bindings,
) => {
  const result = await query(
    bindings,
    'select app.receive_purchase_order($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::text,$6::text,$7::text,$8::text) as response',
    [userId, tenantId, id, JSON.stringify(request.lines), request.deliveryReference, key, hash, requestId],
  )
  return purchaseReceiptResponseSchema.parse(result.rows[0]?.response)
}
