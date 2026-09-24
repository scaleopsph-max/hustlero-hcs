import { z } from 'zod'

const id = z.uuid()
const quantity = z.number().int().positive().max(999_999_999_999)
const money = z.number().int().min(0).max(99_999_999_999)
const transferItem = z.object({
  id,
  variantId: id,
  productName: z.string(),
  variantName: z.string(),
  sku: z.string(),
  requestedQuantityMilli: quantity,
  receivedQuantityMilli: z.number().int().min(0),
  unitCostMinor: money,
})
export const transferCreateRequestSchema = z.strictObject({
  transferNumber: z.string().trim().min(2).max(64),
  sourceLocationId: id,
  destinationLocationId: id,
  items: z
    .array(z.object({ variantId: id, quantityMilli: quantity }))
    .min(1)
    .max(500),
})
export const transferCreateResponseSchema = z.object({
  stockTransferId: id,
  status: z.literal('draft'),
  itemCount: z.number().int().positive(),
})
export const transferDispatchResponseSchema = z.object({ stockTransferId: id, status: z.literal('dispatched') })
export const transferReceiveRequestSchema = z.strictObject({
  items: z
    .array(z.object({ stockTransferItemId: id, quantityMilli: quantity }))
    .min(1)
    .max(500),
})
export const transferReceiveResponseSchema = z.object({
  stockTransferId: id,
  status: z.enum(['partially_received', 'received']),
  itemCount: z.number().int().positive(),
})
export const transferContextSchema = z.object({
  locations: z.array(z.object({ id, code: z.string(), name: z.string() })),
  variants: z.array(
    z.object({
      id,
      productName: z.string(),
      variantName: z.string(),
      sku: z.string(),
      defaultUnitCostMinor: money.nullable(),
    }),
  ),
  transfers: z.array(
    z.object({
      id,
      transferNumber: z.string(),
      sourceLocationId: id,
      sourceLocationName: z.string(),
      destinationLocationId: id,
      destinationLocationName: z.string(),
      status: z.enum(['draft', 'dispatched', 'partially_received', 'received', 'cancelled']),
      createdAt: z.iso.datetime({ offset: true }),
      items: z.array(transferItem),
    }),
  ),
})
export type TransferCreateRequest = z.infer<typeof transferCreateRequestSchema>
export type TransferReceiveRequest = z.infer<typeof transferReceiveRequestSchema>
export type TransferContext = z.infer<typeof transferContextSchema>
