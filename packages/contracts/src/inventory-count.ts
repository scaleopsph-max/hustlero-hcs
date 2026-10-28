import { z } from 'zod'

const id = z.uuid()
const revision = z.number().int().min(1).max(2_147_483_647)
const reason = z.string().trim().min(3).max(240)
const quantityMilli = z.number().int().min(0).max(999_999_999_999)

/** The actor, tenant, permissions, branch scope and stock snapshot come from the server. */
export const inventoryCountCreateSchema = z.strictObject({
  locationId: id,
  variantIds: z
    .array(id)
    .min(1)
    .max(500)
    .refine((rows) => new Set(rows).size === rows.length, 'Duplicate variants'),
})
export const inventoryCountEntrySchema = z.strictObject({
  expectedRevision: revision,
  entries: z
    .array(z.strictObject({ variantId: id, countedMilli: quantityMilli }))
    .min(1)
    .max(500)
    .refine((rows) => new Set(rows.map((row) => row.variantId)).size === rows.length, 'Duplicate variants'),
})
export const inventoryCountSubmitSchema = z.strictObject({ expectedRevision: revision })
export const inventoryCountPostSchema = z.strictObject({ expectedRevision: revision, reason })
export const inventoryCountCancelSchema = z.strictObject({ expectedRevision: revision, reason })
export const inventoryCountDraftSchema = z.object({
  id,
  locationId: id,
  status: z.enum(['draft', 'counting']),
  revision,
  createdAt: z.iso.datetime({ offset: true }),
  lines: z
    .array(
      z.object({
        variantId: id,
        expectedMilli: quantityMilli,
        balanceVersion: z.number().int().nonnegative(),
        countedMilli: quantityMilli.nullable(),
      }),
    )
    .min(1)
    .max(500),
})

export type InventoryCountCreate = z.infer<typeof inventoryCountCreateSchema>
export type InventoryCountEntryCommand = z.infer<typeof inventoryCountEntrySchema>
export type InventoryCountDraft = z.infer<typeof inventoryCountDraftSchema>
