import { z } from 'zod'

const id = z.uuid()

export const wholesaleOrderStatusSchema = z.enum([
  'draft',
  'confirmed',
  'partially_fulfilled',
  'fulfilled',
  'cancelled',
])

export const wholesaleOrderContextSchema = z.object({
  canManage: z.boolean(),
  customers: z.array(z.object({ id, customerNumber: z.string(), fullName: z.string() })),
  locations: z.array(z.object({ id, code: z.string(), name: z.string() })),
  variants: z.array(z.object({ id, productName: z.string(), variantName: z.string(), sku: z.string() })),
  inventory: z.array(
    z.object({
      locationId: id,
      variantId: id,
      onHandMilli: z.number().int(),
      reservedMilli: z.number().int().nonnegative(),
      availableMilli: z.number().int().nonnegative(),
    }),
  ),
  priceLists: z.array(
    z.object({
      id,
      code: z.string(),
      name: z.string(),
      pricingType: z.enum(['wholesale', 'dealer']),
      isDefault: z.boolean(),
      customerIds: z.array(id),
      entries: z.array(
        z.object({
          variantId: id,
          unitPriceMinor: z.number().int().nonnegative(),
          pricingGroupId: id,
          thresholdMilli: z.number().int().positive(),
          pricingGroupName: z.string(),
        }),
      ),
    }),
  ),
  orders: z.array(
    z.object({
      id,
      orderNumber: z.string(),
      customerId: id,
      customerName: z.string(),
      locationId: id,
      locationName: z.string(),
      priceListId: id,
      pricingType: z.enum(['wholesale', 'dealer']),
      status: wholesaleOrderStatusSchema,
      notes: z.string().nullable(),
      subtotalMinor: z.number().int().nonnegative(),
      totalMinor: z.number().int().nonnegative(),
      confirmedAt: z.string().nullable(),
      createdAt: z.string(),
      lines: z.array(
        z.object({
          id,
          variantId: id,
          productName: z.string(),
          variantName: z.string(),
          sku: z.string(),
          orderedQuantityMilli: z.number().int().positive(),
          fulfilledQuantityMilli: z.number().int().nonnegative(),
          cancelledQuantityMilli: z.number().int().nonnegative(),
          unitPriceMinor: z.number().int().nonnegative(),
          lineTotalMinor: z.number().int().nonnegative(),
        }),
      ),
    }),
  ),
})

export const wholesaleOrderDraftRequestSchema = z
  .object({
    id: id.optional(),
    orderNumber: z.string().trim().min(2).max(64),
    customerId: id,
    locationId: id,
    priceListId: id,
    pricingType: z.enum(['wholesale', 'dealer']),
    notes: z.string().trim().max(1000).nullable().default(null),
    lines: z
      .array(z.object({ variantId: id, quantityMilli: z.number().int().positive() }))
      .min(1)
      .max(500),
  })
  .strict()
  .refine((order) => new Set(order.lines.map((line) => line.variantId)).size === order.lines.length, {
    message: 'Duplicate variants are not allowed.',
    path: ['lines'],
  })

export const wholesaleOrderDraftResponseSchema = z.object({
  salesOrderId: id,
  status: z.literal('draft'),
  result: z.enum(['created', 'updated']),
  lineCount: z.number().int().positive(),
  totalMinor: z.number().int().nonnegative(),
})

export const wholesaleOrderConfirmResponseSchema = z.object({
  salesOrderId: id,
  status: z.literal('confirmed'),
  reservedLineCount: z.number().int().positive(),
  totalMinor: z.number().int().nonnegative(),
})

export const wholesaleOrderCancelRequestSchema = z.object({ reason: z.string().trim().min(2).max(500) }).strict()

export const wholesaleOrderCancelResponseSchema = z.object({
  salesOrderId: id,
  status: z.literal('cancelled'),
  releasedQuantityMilli: z.number().int().positive(),
})

export type WholesaleOrderContext = z.infer<typeof wholesaleOrderContextSchema>
export type WholesaleOrderDraftRequest = z.infer<typeof wholesaleOrderDraftRequestSchema>
export type WholesaleOrderDraftResponse = z.infer<typeof wholesaleOrderDraftResponseSchema>
export type WholesaleOrderConfirmResponse = z.infer<typeof wholesaleOrderConfirmResponseSchema>
export type WholesaleOrderCancelRequest = z.infer<typeof wholesaleOrderCancelRequestSchema>
export type WholesaleOrderCancelResponse = z.infer<typeof wholesaleOrderCancelResponseSchema>
