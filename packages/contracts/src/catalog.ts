import { z } from 'zod'

const identifierSchema = z.uuid()
const moneyMinorSchema = z.number().int().min(0).max(99_999_999_999)

export const catalogProductCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  categoryName: z.string().trim().max(80).optional(),
  categoryId: identifierSchema.nullable().optional(),
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

export const catalogVariantUpdateRequestSchema = catalogVariantCreateRequestSchema

export const catalogVariantUpdateResponseSchema = z.object({
  productId: identifierSchema,
  variantId: identifierSchema,
  status: z.literal('updated'),
})

export const catalogVariantDeactivateResponseSchema = z.object({
  productId: identifierSchema,
  variantId: identifierSchema,
  status: z.literal('deactivated'),
})

export const catalogProductUpdateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().default(null),
  categoryName: z.string().trim().max(80).nullable().default(null),
  categoryId: identifierSchema.nullable().optional(),
})

export const catalogProductUpdateResponseSchema = z.object({
  productId: identifierSchema,
  status: z.literal('updated'),
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
export type CatalogVariantUpdateRequest = z.infer<typeof catalogVariantUpdateRequestSchema>
export type CatalogVariantUpdateResponse = z.infer<typeof catalogVariantUpdateResponseSchema>
export type CatalogVariantDeactivateResponse = z.infer<typeof catalogVariantDeactivateResponseSchema>
export type CatalogProductUpdateRequest = z.infer<typeof catalogProductUpdateRequestSchema>
export type CatalogProductUpdateResponse = z.infer<typeof catalogProductUpdateResponseSchema>
export type CatalogResponse = z.infer<typeof catalogResponseSchema>

export const catalogCategoryCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('create'), name: z.string().trim().min(1).max(80) }),
  z.strictObject({ action: z.literal('rename'), categoryId: identifierSchema, name: z.string().trim().min(1).max(80) }),
  z.strictObject({ action: z.literal('archive'), categoryId: identifierSchema }),
])
export const catalogCategoryCommandResponseSchema = z.strictObject({
  categoryId: identifierSchema,
  name: z.string().min(1),
  status: z.enum(['active', 'archived']),
})
export const catalogCategoriesContextSchema = z.object({
  canManage: z.boolean(),
  categories: z.array(
    catalogCategorySchema.extend({
      status: z.enum(['active', 'archived']),
      productCount: z.number().int().nonnegative(),
      pricingGroupCount: z.number().int().nonnegative(),
    }),
  ),
})
export type CatalogCategoryCommand = z.infer<typeof catalogCategoryCommandSchema>
export type CatalogCategoryCommandResponse = z.infer<typeof catalogCategoryCommandResponseSchema>
export type CatalogCategoriesContext = z.infer<typeof catalogCategoriesContextSchema>
