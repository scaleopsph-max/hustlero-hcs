import { z } from 'zod'

const id = z.uuid()
const revision = z.number().int().min(1).max(2_147_483_647)
const reason = z.string().trim().min(3).max(240)
const quantityMilli = z.number().int().min(0).max(999_999_999_999)
const countStatus = z.enum(['draft', 'counting', 'submitted', 'awaiting_approval', 'approved', 'posted', 'cancelled'])

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
export const inventoryCountDecisionSchema = z.strictObject({
  expectedRevision: revision,
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(240).nullable().optional(),
})
export const inventoryCountPostSchema = z.strictObject({ expectedRevision: revision, reason })
export const inventoryCountCancelSchema = z.strictObject({ expectedRevision: revision, reason })
/** A count-only grant for one existing employee and branch; identity and authority are server-derived. */
export const inventoryCountStaffAccessSchema = z.strictObject({
  employeeId: id,
  locationId: id,
  enabled: z.boolean(),
})
export const inventoryCountDraftSchema = z.object({
  id,
  locationId: id,
  status: countStatus,
  revision,
  createdAt: z.iso.datetime({ offset: true }),
  approvalRequestId: id.nullable().optional(),
  decision: z.enum(['approved', 'rejected']).optional(),
  movementIds: z.array(id).max(500).optional(),
  lines: z
    .array(
      z.object({
        variantId: id,
        productName: z.string().min(1).optional(),
        variantName: z.string().min(1).optional(),
        sku: z.string().min(1).optional(),
        expectedMilli: quantityMilli,
        balanceVersion: z.number().int().nonnegative(),
        countedMilli: quantityMilli.nullable(),
        currentOnHandMilli: z.number().int().nullable().optional(),
        currentBalanceVersion: z.number().int().nonnegative().nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
})
export const inventoryCountListSchema = z.object({
  counts: z
    .array(z.object({ id, locationId: id, status: countStatus, revision, createdAt: z.iso.datetime({ offset: true }) }))
    .max(100),
  locations: z
    .array(
      z.object({
        id,
        name: z.string().min(1).optional(),
        canCreate: z.boolean(),
        canEnter: z.boolean(),
        canApprove: z.boolean(),
        canPost: z.boolean(),
      }),
    )
    .default([]),
})

export type InventoryCountCreate = z.infer<typeof inventoryCountCreateSchema>
export type InventoryCountEntryCommand = z.infer<typeof inventoryCountEntrySchema>
export type InventoryCountDraft = z.infer<typeof inventoryCountDraftSchema>
export type InventoryCountList = z.infer<typeof inventoryCountListSchema>
export type InventoryCountSubmit = z.infer<typeof inventoryCountSubmitSchema>
export type InventoryCountDecision = z.infer<typeof inventoryCountDecisionSchema>
export type InventoryCountPost = z.infer<typeof inventoryCountPostSchema>
export type InventoryCountStaffAccess = z.infer<typeof inventoryCountStaffAccessSchema>
