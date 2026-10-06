import { z } from 'zod'

const id = z.uuid()

export const pricingTypeSchema = z.enum(['retail', 'wholesale', 'dealer'])
export const wholesalePricingTypeSchema = z.enum(['wholesale', 'dealer'])

export const pricingContextSchema = z.object({
  canManage: z.boolean(),
  variants: z.array(
    z.object({
      id,
      productName: z.string(),
      variantName: z.string(),
      sku: z.string(),
      retailPriceMinor: z.number().int().nonnegative(),
    }),
  ),
  customers: z.array(
    z.object({ id, customerNumber: z.string(), fullName: z.string(), customerType: z.literal('reseller') }),
  ),
  priceLists: z.array(
    z.object({
      id,
      code: z.string(),
      name: z.string(),
      pricingType: wholesalePricingTypeSchema,
      isDefault: z.boolean(),
      isActive: z.boolean(),
      pricingGroup: z.object({ id, code: z.string(), name: z.string(), thresholdMilli: z.number().int().positive() }),
      customerIds: z.array(id),
      entries: z.array(z.object({ variantId: id, unitPriceMinor: z.number().int().nonnegative() })),
    }),
  ),
})

export const priceListUpsertRequestSchema = z.object({
  id: id.optional(),
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(120),
  pricingType: wholesalePricingTypeSchema,
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  pricingGroup: z.object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9_-]+$/),
    name: z.string().trim().min(1).max(120),
    thresholdMilli: z.number().int().positive(),
  }),
  customerIds: z.array(id).max(500).default([]),
  entries: z
    .array(z.object({ variantId: id, unitPriceMinor: z.number().int().nonnegative() }))
    .min(1)
    .max(2_000)
    .refine(
      (entries) => new Set(entries.map((entry) => entry.variantId)).size === entries.length,
      'Duplicate variants',
    ),
})

export const priceListUpsertResponseSchema = z.object({
  priceListId: id,
  pricingGroupId: id,
  status: z.enum(['created', 'updated']),
})

export type PricingType = z.infer<typeof pricingTypeSchema>
export type PricingContext = z.infer<typeof pricingContextSchema>
export type PriceListUpsertRequest = z.infer<typeof priceListUpsertRequestSchema>
export type PriceListUpsertResponse = z.infer<typeof priceListUpsertResponseSchema>
