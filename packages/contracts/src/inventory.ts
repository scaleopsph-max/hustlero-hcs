import { z } from 'zod'

const identifierSchema = z.uuid()
const quantityMilliSchema = z.number().int().min(0).max(999_999_999_999)
const moneyMinorSchema = z.number().int().min(0).max(99_999_999_999)

export const inventoryMovementTypeSchema = z.enum([
  'OPENING_BALANCE',
  'SALE',
  'REFUND',
  'PURCHASE_RECEIPT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'DAMAGE',
  'ADJUSTMENT',
  'RETURN_TO_SUPPLIER',
])

const inventoryLocationSchema = z.object({
  id: identifierSchema,
  code: z.string().min(1),
  name: z.string().min(1),
})

export const openingInventoryEntrySchema = z.strictObject({
  variantId: identifierSchema,
  quantityMilli: quantityMilliSchema.refine((value) => value > 0),
  unitCostMinor: moneyMinorSchema,
})

export const openingInventoryCreateRequestSchema = z.strictObject({
  locationId: identifierSchema,
  entries: z.array(openingInventoryEntrySchema).min(1).max(500),
})

export const openingInventoryCreateResponseSchema = z.object({
  locationId: identifierSchema,
  movementCount: z.number().int().positive(),
  status: z.literal('recorded'),
})

export const inventoryAdjustmentCreateRequestSchema = z.strictObject({
  locationId: identifierSchema,
  variantId: identifierSchema,
  quantityMilli: z
    .number()
    .int()
    .min(-999_999_999_999)
    .max(999_999_999_999)
    .refine((value) => value !== 0),
  unitCostMinor: moneyMinorSchema.nullable(),
  reason: z.string().trim().min(3).max(240),
})

export const inventoryAdjustmentCreateResponseSchema = z.discriminatedUnion('status', [
  z.object({
    movementId: identifierSchema,
    locationId: identifierSchema,
    variantId: identifierSchema,
    quantityMilli: z.number().int(),
    onHandMilli: z.number().int(),
    status: z.literal('recorded'),
  }),
  z.object({
    approvalRequestId: identifierSchema,
    locationId: identifierSchema,
    variantId: identifierSchema,
    quantityMilli: z.number().int(),
    status: z.literal('pending_approval'),
  }),
])

export const openingInventoryContextSchema = z.object({
  locations: z.array(inventoryLocationSchema),
  selectedLocationId: identifierSchema,
  items: z.array(
    z.object({
      productId: identifierSchema,
      productName: z.string().min(1),
      variantId: identifierSchema,
      variantName: z.string().min(1),
      sku: z.string().min(1),
      defaultUnitCostMinor: moneyMinorSchema.nullable(),
      openingUnitCostMinor: moneyMinorSchema.nullable(),
      openingQuantityMilli: quantityMilliSchema,
      onHandMilli: z.number().int(),
      opened: z.boolean(),
    }),
  ),
})

export const inventoryStockContextSchema = z.object({
  locations: z.array(inventoryLocationSchema),
  selectedLocationId: identifierSchema,
  items: z.array(
    z.object({
      productId: identifierSchema,
      productName: z.string().min(1),
      variantId: identifierSchema,
      variantName: z.string().min(1),
      sku: z.string().min(1),
      barcodeCount: z.number().int().min(0),
      onHandMilli: z.number().int(),
      reservedMilli: z.number().int().min(0),
      availableMilli: z.number().int(),
      inTransitMilli: z.number().int().min(0),
      damagedMilli: z.number().int().min(0),
      averageUnitCostMinor: moneyMinorSchema.nullable(),
      hasBalance: z.boolean(),
    }),
  ),
})

export const inventoryMovementContextSchema = z.object({
  locationId: identifierSchema,
  items: z.array(
    z.object({
      id: identifierSchema,
      productId: identifierSchema,
      productName: z.string().min(1),
      variantId: identifierSchema,
      variantName: z.string().min(1),
      sku: z.string().min(1),
      movementType: inventoryMovementTypeSchema,
      quantityMilli: z.number().int(),
      unitCostMinor: moneyMinorSchema.nullable(),
      sourceType: z.string().min(1),
      sourceReference: z.string().min(1),
      actorLabel: z.string().min(1),
      occurredAt: z.iso.datetime({ offset: true }),
      balanceAfterMilli: z.number().int(),
    }),
  ),
})

export type OpeningInventoryCreateRequest = z.infer<typeof openingInventoryCreateRequestSchema>
export type OpeningInventoryCreateResponse = z.infer<typeof openingInventoryCreateResponseSchema>
export type InventoryAdjustmentCreateRequest = z.infer<typeof inventoryAdjustmentCreateRequestSchema>
export type InventoryAdjustmentCreateResponse = z.infer<typeof inventoryAdjustmentCreateResponseSchema>
export type OpeningInventoryContext = z.infer<typeof openingInventoryContextSchema>
export type InventoryStockContext = z.infer<typeof inventoryStockContextSchema>
export type InventoryMovementContext = z.infer<typeof inventoryMovementContextSchema>
export type InventoryMovementType = z.infer<typeof inventoryMovementTypeSchema>
