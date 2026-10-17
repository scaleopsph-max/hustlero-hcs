import { z } from 'zod'

const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const wholesaleFundAllocationRequestSchema = z
  .strictObject({
    paymentId: z.uuid(),
    capitalMinor: minor,
    operatingMinor: minor,
    settledConfirmed: z.literal(true),
    settlementReference: z.string().trim().min(3).max(100),
    reason: z.string().trim().min(3).max(240),
  })
  .superRefine((value, context) => {
    const total = BigInt(value.capitalMinor) + BigInt(value.operatingMinor)
    if (total === 0n || total > BigInt(Number.MAX_SAFE_INTEGER))
      context.addIssue({ code: 'custom', message: 'Provide a positive safe fund allocation.' })
  })
export const wholesaleFundAllocationResponseSchema = z.strictObject({
  paymentId: z.uuid(),
  capitalMinor: minor,
  operatingMinor: minor,
  recordedAt: z.iso.datetime({ offset: true }),
})
export const wholesaleFundsContextSchema = z.strictObject({
  canManage: z.boolean(),
  funds: z.array(
    z.strictObject({
      fundType: z.enum(['capital_cogs', 'operating']),
      name: z.string(),
      balanceMinor: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    }),
  ),
  payments: z.array(
    z.strictObject({
      paymentId: z.uuid(),
      reference: z.string(),
      amountMinor: minor,
      allocation: wholesaleFundAllocationResponseSchema.nullable(),
    }),
  ),
})
export type WholesaleFundAllocationRequest = z.infer<typeof wholesaleFundAllocationRequestSchema>
export type WholesaleFundAllocationResponse = z.infer<typeof wholesaleFundAllocationResponseSchema>
export type WholesaleFundsContext = z.infer<typeof wholesaleFundsContextSchema>
