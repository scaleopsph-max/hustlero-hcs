import { z } from 'zod'

export const wholesaleCreditOverrideApproveSchema = z.strictObject({
  salesOrderId: z.uuid(),
  action: z.enum(['confirm', 'fulfill']),
  approvedExcessMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  expiresAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(2).max(500),
})
export const wholesaleCreditOverrideRevokeSchema = z.strictObject({ reason: z.string().trim().min(2).max(500) })
export const wholesaleCreditOverrideCommandResponseSchema = z.object({
  overrideId: z.uuid(),
  status: z.enum(['approved', 'revoked']),
})
export const wholesaleCreditOverridesContextSchema = z.object({
  canApprove: z.boolean(),
  overrides: z.array(
    z.object({
      overrideId: z.uuid(),
      salesOrderId: z.uuid(),
      customerId: z.uuid(),
      action: z.enum(['confirm', 'fulfill']),
      approvedExcessMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      expiresAt: z.iso.datetime({ offset: true }),
      reason: z.string(),
      approvedBy: z.uuid(),
      approvedAt: z.iso.datetime({ offset: true }),
      revokedBy: z.uuid().nullable(),
      revokedAt: z.iso.datetime({ offset: true }).nullable(),
      revokeReason: z.string().nullable(),
    }),
  ),
})
export type WholesaleCreditOverrideApprove = z.infer<typeof wholesaleCreditOverrideApproveSchema>
export type WholesaleCreditOverrideRevoke = z.infer<typeof wholesaleCreditOverrideRevokeSchema>
export type WholesaleCreditOverrideCommandResponse = z.infer<typeof wholesaleCreditOverrideCommandResponseSchema>
export type WholesaleCreditOverridesContext = z.infer<typeof wholesaleCreditOverridesContextSchema>
