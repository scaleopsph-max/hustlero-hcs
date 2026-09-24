import { z } from 'zod'

const identifierSchema = z.uuid()
const quantityMilliSchema = z.number().int().min(0).max(999_999_999_999)
const moneyMinorSchema = z.number().int().min(0).max(99_999_999_999)

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

export const openingInventoryContextSchema = z.object({
  locations: z.array(
    z.object({
      id: identifierSchema,
      code: z.string().min(1),
      name: z.string().min(1),
    }),
  ),
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

export type OpeningInventoryCreateRequest = z.infer<typeof openingInventoryCreateRequestSchema>
export type OpeningInventoryCreateResponse = z.infer<typeof openingInventoryCreateResponseSchema>
export type OpeningInventoryContext = z.infer<typeof openingInventoryContextSchema>
