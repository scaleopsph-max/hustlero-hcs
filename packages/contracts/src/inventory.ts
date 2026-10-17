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

export const inventoryReorderLevelUpdateRequestSchema = z.strictObject({
  locationId: identifierSchema,
  variantId: identifierSchema,
  reorderLevelMilli: quantityMilliSchema.nullable(),
})

export const inventoryReorderLevelUpdateResponseSchema = z.object({
  locationId: identifierSchema,
  variantId: identifierSchema,
  reorderLevelMilli: quantityMilliSchema.nullable(),
  status: z.literal('updated'),
})

const inventoryImportRawValueSchema = z.string().trim().max(240).default('')

export const inventoryImportPreviewRowSchema = z.strictObject({
  rowNumber: z.number().int().min(2).max(5001),
  branchCode: inventoryImportRawValueSchema,
  sku: inventoryImportRawValueSchema,
  barcode: inventoryImportRawValueSchema,
  quantityOnHand: inventoryImportRawValueSchema,
  unitCost: inventoryImportRawValueSchema,
  reorderLevel: inventoryImportRawValueSchema,
  reservedQuantity: inventoryImportRawValueSchema,
  damagedQuantity: inventoryImportRawValueSchema,
  inTransitQuantity: inventoryImportRawValueSchema,
  sourceReference: inventoryImportRawValueSchema,
})

export const inventoryImportPreviewRequestSchema = z.strictObject({
  filename: z.string().trim().min(1).max(255),
  cutoverAt: z.iso.datetime({ offset: true }),
  rows: z.array(inventoryImportPreviewRowSchema).min(1).max(5000),
})

const inventoryImportIssueSchema = z.object({
  code: z.string().min(1),
  field: z.string().min(1),
  message: z.string().min(1),
})

export const inventoryImportPreviewResponseSchema = z.object({
  batchId: identifierSchema,
  status: z.literal('previewed'),
  filename: z.string().min(1),
  cutoverAt: z.iso.datetime({ offset: true }),
  summary: z.object({
    rowCount: z.number().int().min(0),
    acceptedCount: z.number().int().min(0),
    rejectedCount: z.number().int().min(0),
    warningCount: z.number().int().min(0),
    totalQuantityMilli: quantityMilliSchema,
    totalValuationMinor: moneyMinorSchema,
    branches: z.array(
      z.object({
        branchCode: z.string(),
        acceptedCount: z.number().int().min(0),
        rejectedCount: z.number().int().min(0),
        totalQuantityMilli: quantityMilliSchema,
        totalValuationMinor: moneyMinorSchema,
      }),
    ),
  }),
  rows: z.array(
    z.object({
      rowNumber: z.number().int().min(2),
      branchCode: z.string(),
      sku: z.string().nullable(),
      barcode: z.string().nullable(),
      locationId: identifierSchema.nullable(),
      variantId: identifierSchema.nullable(),
      productName: z.string().nullable(),
      variantName: z.string().nullable(),
      quantityOnHandMilli: quantityMilliSchema.nullable(),
      unitCostMinor: moneyMinorSchema.nullable(),
      reorderLevelMilli: quantityMilliSchema.nullable(),
      reservedQuantityMilli: quantityMilliSchema.nullable(),
      damagedQuantityMilli: quantityMilliSchema.nullable(),
      inTransitQuantityMilli: quantityMilliSchema.nullable(),
      sourceReference: z.string().nullable(),
      status: z.enum(['accepted', 'rejected']),
      errors: z.array(inventoryImportIssueSchema),
      warnings: z.array(inventoryImportIssueSchema),
    }),
  ),
})

export const inventoryImportBatchCommandRequestSchema = z.strictObject({
  batchId: identifierSchema,
})

export const inventoryImportPostResponseSchema = z.object({
  batchId: identifierSchema,
  status: z.literal('posted'),
  postedAt: z.iso.datetime({ offset: true }),
  movementCount: z.number().int().min(0),
  balanceCount: z.number().int().positive(),
  summary: z.object({
    rowCount: z.number().int().positive(),
    totalQuantityMilli: quantityMilliSchema,
    totalValuationMinor: moneyMinorSchema,
  }),
})

export const inventoryImportReconcileResponseSchema = z.object({
  batchId: identifierSchema,
  status: z.literal('reconciled'),
  reconciledAt: z.iso.datetime({ offset: true }),
  matches: z.literal(true),
  rowCount: z.number().int().positive(),
  expectedQuantityMilli: quantityMilliSchema,
  actualQuantityMilli: quantityMilliSchema,
  expectedValuationMinor: moneyMinorSchema,
  actualValuationMinor: moneyMinorSchema,
})

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
      reorderLevelMilli: quantityMilliSchema.nullable(),
      stockStatus: z.enum(['not_started', 'out_of_stock', 'low_stock', 'in_stock']),
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
export type InventoryReorderLevelUpdateRequest = z.infer<typeof inventoryReorderLevelUpdateRequestSchema>
export type InventoryReorderLevelUpdateResponse = z.infer<typeof inventoryReorderLevelUpdateResponseSchema>
export type InventoryImportPreviewRequest = z.infer<typeof inventoryImportPreviewRequestSchema>
export type InventoryImportPreviewResponse = z.infer<typeof inventoryImportPreviewResponseSchema>
export type InventoryImportBatchCommandRequest = z.infer<typeof inventoryImportBatchCommandRequestSchema>
export type InventoryImportPostResponse = z.infer<typeof inventoryImportPostResponseSchema>
export type InventoryImportReconcileResponse = z.infer<typeof inventoryImportReconcileResponseSchema>
export type OpeningInventoryContext = z.infer<typeof openingInventoryContextSchema>
export type InventoryStockContext = z.infer<typeof inventoryStockContextSchema>
export type InventoryMovementContext = z.infer<typeof inventoryMovementContextSchema>
export type InventoryMovementType = z.infer<typeof inventoryMovementTypeSchema>
