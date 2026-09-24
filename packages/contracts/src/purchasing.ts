import { z } from 'zod'

const id = z.uuid()
const quantity = z.number().int().positive().max(999_999_999_999)
const money = z.number().int().min(0).max(99_999_999_999)

export const supplierCreateRequestSchema = z.strictObject({
  name: z.string().trim().min(2).max(160),
  contactName: z.string().trim().max(160).nullable().default(null),
  contactPhone: z.string().trim().max(40).nullable().default(null),
  contactEmail: z.string().trim().email().max(254).nullable().default(null),
})
export const supplierCreateResponseSchema = z.object({ supplierId: id, status: z.literal('created') })

const purchaseOrderLineSchema = z.object({
  id: id,
  variantId: id,
  productName: z.string().min(1),
  variantName: z.string().min(1),
  sku: z.string().min(1),
  orderedQuantityMilli: quantity,
  receivedQuantityMilli: z.number().int().min(0),
  unitCostMinor: money,
})
export const purchaseOrderCreateRequestSchema = z.strictObject({
  supplierId: id,
  locationId: id,
  orderNumber: z.string().trim().min(2).max(64),
  expectedAt: z.iso.datetime({ offset: true }).nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null),
  lines: z
    .array(z.object({ variantId: id, quantityMilli: quantity, unitCostMinor: money }))
    .min(1)
    .max(500),
})
export const purchaseOrderCreateResponseSchema = z.object({
  purchaseOrderId: id,
  status: z.literal('draft'),
  lineCount: z.number().int().positive(),
})
export const purchaseOrderSendResponseSchema = z.object({ purchaseOrderId: id, status: z.literal('ordered') })
export const purchaseReceiptRequestSchema = z.strictObject({
  lines: z
    .array(z.object({ purchaseOrderLineId: id, quantityMilli: quantity }))
    .min(1)
    .max(500),
  deliveryReference: z.string().trim().max(160).nullable().default(null),
})
export const purchaseReceiptResponseSchema = z.object({
  purchaseReceiptId: id,
  purchaseOrderId: id,
  status: z.enum(['partially_received', 'received']),
  lineCount: z.number().int().positive(),
})

export const purchasingContextSchema = z.object({
  suppliers: z.array(
    z.object({
      id,
      name: z.string(),
      contactName: z.string().nullable(),
      contactPhone: z.string().nullable(),
      contactEmail: z.string().nullable(),
      status: z.enum(['active', 'archived']),
    }),
  ),
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
  orders: z.array(
    z.object({
      id,
      supplierId: id,
      supplierName: z.string(),
      locationId: id,
      locationName: z.string(),
      orderNumber: z.string(),
      status: z.enum(['draft', 'ordered', 'partially_received', 'received', 'cancelled']),
      orderedAt: z.iso.datetime({ offset: true }).nullable(),
      expectedAt: z.iso.datetime({ offset: true }).nullable(),
      notes: z.string().nullable(),
      lines: z.array(purchaseOrderLineSchema),
    }),
  ),
})

export type SupplierCreateRequest = z.infer<typeof supplierCreateRequestSchema>
export type SupplierCreateResponse = z.infer<typeof supplierCreateResponseSchema>
export type PurchaseOrderCreateRequest = z.infer<typeof purchaseOrderCreateRequestSchema>
export type PurchaseOrderCreateResponse = z.infer<typeof purchaseOrderCreateResponseSchema>
export type PurchaseOrderSendResponse = z.infer<typeof purchaseOrderSendResponseSchema>
export type PurchaseReceiptRequest = z.infer<typeof purchaseReceiptRequestSchema>
export type PurchaseReceiptResponse = z.infer<typeof purchaseReceiptResponseSchema>
export type PurchasingContext = z.infer<typeof purchasingContextSchema>
