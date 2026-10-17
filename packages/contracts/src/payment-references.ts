import { z } from 'zod'

export const paymentReferenceLastFourSchema = z.string().regex(/^[0-9]{4}$/, 'Enter exactly four reference digits.')
export function requiresPaymentReference(type: string): boolean {
  return type === 'e_wallet' || type === 'bank_transfer'
}

export const posPaymentReferenceReportSchema = z.object({
  timezone: z.string(),
  locations: z.array(z.object({ id: z.uuid(), name: z.string() })),
  rows: z.array(
    z.object({
      paymentId: z.uuid(),
      saleId: z.uuid().nullable(),
      channel: z.enum(['pos', 'wholesale']).optional(),
      receiptNumber: z.string(),
      completedAt: z.iso.datetime({ offset: true }),
      locationId: z.uuid().nullable(),
      locationName: z.string(),
      cashierName: z.string(),
      customerName: z.string().nullable(),
      paymentMethodId: z.uuid(),
      methodName: z.string(),
      methodType: z.enum(['e_wallet', 'bank_transfer']),
      amountMinor: z.number().int().nonnegative(),
      reversedMinor: z.number().int().nonnegative(),
      referenceLastFour: paymentReferenceLastFourSchema.nullable(),
    }),
  ),
})
export type PosPaymentReferenceReport = z.infer<typeof posPaymentReferenceReportSchema>
