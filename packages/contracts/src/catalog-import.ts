import { z } from 'zod'
const id = z.uuid()
const raw = z.string().max(2000).optional()
export const catalogImportPreviewRequestSchema = z.strictObject({
  filename: z.string().trim().min(1).max(255),
  rows: z
    .array(
      z.strictObject({
        product_sku: raw,
        product_name: raw,
        description: raw,
        category: raw,
        variant_name: raw,
        sku: raw,
        barcode: raw,
        retail_price: raw,
        unit_cost: raw,
        track_inventory: raw,
      }),
    )
    .min(1)
    .max(5000),
})
export const catalogImportSnapshotSchema = z.object({
  categories: z.array(z.object({ id, name: z.string(), status: z.enum(['active', 'archived']) })),
  products: z.array(
    z.object({
      id,
      name: z.string(),
      description: z.string().nullable(),
      categoryId: id.nullable(),
      status: z.enum(['active', 'inactive', 'archived']),
      variants: z.array(
        z.object({
          id,
          sku: z.string(),
          isActive: z.boolean(),
          trackInventory: z.boolean(),
          barcodes: z.array(z.string()),
        }),
      ),
    }),
  ),
})
const money = z.number().int().min(0).max(99_999_999_999).nullable()
export const catalogImportPreviewResponseSchema = z.object({
  filename: z.string(),
  rows: z
    .array(
      z.object({
        rowNumber: z.number().int().min(2).max(5001),
        issues: z.array(z.object({ code: z.string(), field: z.string() })),
        action: z.enum(['create_product', 'create_variant', 'update_variant']).nullable(),
        productId: id.nullable(),
        variantId: id.nullable(),
        productSku: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        categoryId: id.nullable(),
        variantName: z.string(),
        sku: z.string(),
        barcodes: z.array(z.string()),
        retailPriceMinor: money,
        unitCostMinor: money,
        trackInventory: z.boolean(),
      }),
    )
    .min(1)
    .max(5000),
})
export type CatalogImportPreviewRequest = z.infer<typeof catalogImportPreviewRequestSchema>
export type CatalogImportPreviewResponse = z.infer<typeof catalogImportPreviewResponseSchema>
export type CatalogImportSnapshot = z.infer<typeof catalogImportSnapshotSchema>
