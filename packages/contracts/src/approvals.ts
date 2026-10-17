import { z } from 'zod'

const identifierSchema = z.uuid()
const nullableThresholdSchema = z.number().int().min(0).max(999_999_999_999).nullable()

export const approvalPolicyUpdateRequestSchema = z.strictObject({
  inventoryAdjustmentThresholdMilli: nullableThresholdSchema,
})

export const approvalPolicyUpdateResponseSchema = z.object({
  inventoryAdjustmentThresholdMilli: nullableThresholdSchema,
  status: z.literal('updated'),
})

export const approvalDecisionRequestSchema = z.strictObject({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(240).nullable().default(null),
})

export const approvalDecisionResponseSchema = z.object({
  approvalRequestId: identifierSchema,
  movementId: identifierSchema.nullable(),
  status: z.enum(['approved', 'rejected']),
})

export const approvalCenterSchema = z.object({
  canManage: z.boolean(),
  inventoryAdjustmentThresholdMilli: nullableThresholdSchema,
  requests: z.array(
    z.object({
      id: identifierSchema,
      subjectType: z.literal('inventory_adjustment'),
      status: z.enum(['pending', 'approved', 'rejected']),
      locationId: identifierSchema,
      locationName: z.string().min(1),
      variantId: identifierSchema,
      productName: z.string().min(1),
      variantName: z.string().min(1),
      sku: z.string().min(1),
      quantityMilli: z.number().int(),
      unitCostMinor: z.number().int().min(0).nullable(),
      reason: z.string().min(3),
      requestedByLabel: z.string().min(1),
      requestedAt: z.iso.datetime({ offset: true }),
      decidedByLabel: z.string().min(1).nullable(),
      decidedAt: z.iso.datetime({ offset: true }).nullable(),
      decisionNote: z.string().nullable(),
    }),
  ),
})

export type ApprovalPolicyUpdateRequest = z.infer<typeof approvalPolicyUpdateRequestSchema>
export type ApprovalPolicyUpdateResponse = z.infer<typeof approvalPolicyUpdateResponseSchema>
export type ApprovalDecisionRequest = z.infer<typeof approvalDecisionRequestSchema>
export type ApprovalDecisionResponse = z.infer<typeof approvalDecisionResponseSchema>
export type ApprovalCenter = z.infer<typeof approvalCenterSchema>
