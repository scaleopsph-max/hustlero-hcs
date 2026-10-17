import { z } from 'zod'

const id = z.uuid()
const timestamp = z.iso.datetime({ offset: true })

export const loyaltyTransactionSchema = z.object({
  id,
  customerId: id.optional(),
  customerNumber: z.string().optional(),
  customerName: z.string().optional(),
  type: z.enum(['sale_earn', 'refund_reversal']),
  pointsDelta: z.number().int(),
  balanceAfterPoints: z.number().int().nonnegative(),
  receiptNumber: z.string(),
  occurredAt: timestamp,
})

export const loyaltyContextSchema = z.object({
  policy: z.object({
    enabled: z.boolean(),
    spendPerPointCentavos: z.number().int().positive().nullable(),
    updatedAt: timestamp,
  }),
  canManage: z.boolean(),
  summary: z.object({
    memberCount: z.number().int().nonnegative(),
    outstandingPoints: z.number().int().nonnegative(),
    lifetimeEarnedPoints: z.number().int().nonnegative(),
    lifetimeReversedPoints: z.number().int().nonnegative(),
  }),
  recentTransactions: z.array(loyaltyTransactionSchema),
})

export const loyaltyPolicyUpdateRequestSchema = z
  .strictObject({
    enabled: z.boolean(),
    spendPerPointCentavos: z.number().int().positive().nullable(),
  })
  .refine((value) => !value.enabled || value.spendPerPointCentavos !== null, {
    message: 'Set the spend required to earn one point before enabling loyalty.',
  })

export const loyaltyPolicyUpdateResponseSchema = z.object({
  enabled: z.boolean(),
  spendPerPointCentavos: z.number().int().positive().nullable(),
  status: z.literal('updated'),
})

export type LoyaltyContext = z.infer<typeof loyaltyContextSchema>
export type LoyaltyPolicyUpdateRequest = z.infer<typeof loyaltyPolicyUpdateRequestSchema>
