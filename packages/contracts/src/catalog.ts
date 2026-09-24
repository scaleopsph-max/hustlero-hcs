import { z } from 'zod'

const identifierSchema = z.uuid()
const moneyMinorSchema = z.number().int().min(0).max(99_999_999_999)

export const catalogProductCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  categoryName: z.string().trim().max(80).optional(),
  variantName: z.string().trim().min(1).max(80).default('Default'),
  sku: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/),
  retailPriceMinor: moneyMinorSchema,
  unitCostMinor: moneyMinorSchema.nullable().default(null),
  trackInventory: z.boolean().default(true),
  barcodes: z
    .array(
      z
        .string()
        .trim()
        .min(3)
        .max(64)
        .regex(/^[A-Za-z0-9._-]+$/),
    )
    .max(10)
    .default([]),
})

export const catalogProductCreateResponseSchema = z.object({
  productId: identifierSchema,
  variantId: identifierSchema,
  status: z.literal('created'),
})

export const catalogVariantCreateRequestSchema = z.object({
  variantName: z.string().trim().min(1).max(80),
  sku: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/),
  retailPriceMinor: moneyMinorSchema,
  unitCostMinor: moneyMinorSchema.nullable().default(null),
  trackInventory: z.boolean().default(true),
  barcodes: z
    .array(
      z
        .string()
        .trim()
        .min(3)
        .max(64)
        .regex(/^[A-Za-z0-9._-]+$/),
    )
    .max(10)
    .default([]),
})

export const catalogVariantCreateResponseSchema = z.object({
  productId: identifierSchema,
  variantId: identifierSchema,
  status: z.literal('created'),
})

export const catalogCategorySchema = z.object({ id: identifierSchema, name: z.string().min(1) })

export const catalogVariantSchema = z.object({
  id: identifierSchema,
  name: z.string().min(1),
  sku: z.string().min(1),
  retailPriceMinor: moneyMinorSchema,
  unitCostMinor: moneyMinorSchema.nullable(),
  trackInventory: z.boolean(),
  isActive: z.boolean(),
  barcodes: z.array(z.string().min(1)),
})

export const catalogProductSchema = z.object({
  id: identifierSchema,
  name: z.string().min(1),
  description: z.string().nullable(),
  status: z.enum(['active', 'inactive', 'archived']),
  category: catalogCategorySchema.nullable(),
  variants: z.array(catalogVariantSchema).min(1),
})

export const catalogResponseSchema = z.object({
  categories: z.array(catalogCategorySchema),
  products: z.array(catalogProductSchema),
})

export type CatalogProductCreateRequest = z.infer<typeof catalogProductCreateRequestSchema>
export type CatalogProductCreateResponse = z.infer<typeof catalogProductCreateResponseSchema>
export type CatalogVariantCreateRequest = z.infer<typeof catalogVariantCreateRequestSchema>
export type CatalogVariantCreateResponse = z.infer<typeof catalogVariantCreateResponseSchema>
export type CatalogResponse = z.infer<typeof catalogResponseSchema>
