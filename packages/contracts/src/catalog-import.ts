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
        categoryName: z.string().nullable(),
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

export const catalogImportJobSummarySchema = z.object({
  id,
  filename: z.string().min(1).max(255),
  uploaderId: id,
  state: z.enum(['preview', 'cancelled']),
  rowCount: z.number().int().min(1).max(5000),
  rejectedCount: z.number().int().min(0).max(5000),
  proposedCreates: z.number().int().min(0).max(5000),
  proposedUpdates: z.number().int().min(0).max(5000),
  createdAt: z.iso.datetime({ offset: true }),
  cancelledAt: z.iso.datetime({ offset: true }).nullable(),
})
export const catalogImportJobSchema = catalogImportJobSummarySchema
  .extend({
    source: catalogImportPreviewRequestSchema,
    rows: catalogImportPreviewResponseSchema.shape.rows,
  })
  .superRefine((job, context) => {
    if (
      job.rows.length !== job.rowCount ||
      job.rejectedCount + job.proposedCreates + job.proposedUpdates !== job.rowCount ||
      job.rows.some((row) => row.issues.length > 0 !== (row.action === null)) ||
      job.source.rows.length !== job.rowCount ||
      job.source.filename !== job.filename ||
      job.rows.some((row, index) => row.rowNumber !== index + 2) ||
      job.rows.filter((row) => row.issues.length > 0).length !== job.rejectedCount ||
      job.rows.filter((row) => row.action === 'create_product' || row.action === 'create_variant').length !==
        job.proposedCreates ||
      job.rows.filter((row) => row.action === 'update_variant').length !== job.proposedUpdates ||
      (job.state === 'cancelled') !== (job.cancelledAt !== null)
    )
      context.addIssue({ code: 'custom', message: 'Import job totals do not reconcile.' })
  })
export const catalogImportJobListSchema = z.object({ jobs: z.array(catalogImportJobSummarySchema).max(50) })
export const catalogImportJobSavedSchema = z.object({ jobId: id, status: z.literal('saved') })
export type CatalogImportJob = z.infer<typeof catalogImportJobSchema>
export type CatalogImportJobList = z.infer<typeof catalogImportJobListSchema>
export type CatalogImportJobSaved = z.infer<typeof catalogImportJobSavedSchema>
