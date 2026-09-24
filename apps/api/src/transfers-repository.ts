import {
  transferContextSchema,
  transferCreateResponseSchema,
  transferDispatchResponseSchema,
  transferReceiveResponseSchema,
  type TransferContext,
  type TransferCreateRequest,
  type TransferReceiveRequest,
} from '@hcs/contracts'
import { Client } from 'pg'
import type { Bindings } from './env'

export type TransferLoader = (userId: string, tenantId: string, bindings: Bindings) => Promise<TransferContext>
export type TransferCreator = (
  userId: string,
  tenantId: string,
  request: TransferCreateRequest,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<unknown>
export type TransferDispatcher = (
  userId: string,
  tenantId: string,
  id: string,
  key: string,
  hash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<unknown>
export type TransferReceiver = (
  userId: string,
  tenantId: string,
  id: string,
  request: TransferReceiveRequest,
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
export const loadTransfersFromPostgres: TransferLoader = async (userId, tenantId, bindings) =>
  transferContextSchema.parse(
    (await query(bindings, 'select app.list_transfer_context($1::uuid,$2::uuid) as context', [userId, tenantId]))
      .rows[0]?.context,
  )
export const createTransferInPostgres: TransferCreator = async (
  userId,
  tenantId,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  transferCreateResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.create_stock_transfer($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::jsonb,$7::text,$8::text,$9::text) as response',
        [
          userId,
          tenantId,
          request.transferNumber,
          request.sourceLocationId,
          request.destinationLocationId,
          JSON.stringify(request.items),
          key,
          hash,
          requestId,
        ],
      )
    ).rows[0]?.response,
  )
export const dispatchTransferInPostgres: TransferDispatcher = async (
  userId,
  tenantId,
  id,
  key,
  hash,
  requestId,
  bindings,
) =>
  transferDispatchResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.dispatch_stock_transfer($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text) as response',
        [userId, tenantId, id, key, hash, requestId],
      )
    ).rows[0]?.response,
  )
export const receiveTransferInPostgres: TransferReceiver = async (
  userId,
  tenantId,
  id,
  request,
  key,
  hash,
  requestId,
  bindings,
) =>
  transferReceiveResponseSchema.parse(
    (
      await query(
        bindings,
        'select app.receive_stock_transfer($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::text,$6::text,$7::text) as response',
        [userId, tenantId, id, JSON.stringify(request.items), key, hash, requestId],
      )
    ).rows[0]?.response,
  )
