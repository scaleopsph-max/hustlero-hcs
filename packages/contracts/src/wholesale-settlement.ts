import { z } from 'zod'
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const wholesaleSettlementReportSchema = z
  .object({
    scope: z.object({
      from: z.iso.date(),
      to: z.iso.date(),
      locationId: z.uuid().nullable(),
      timezone: z.string(),
      asOf: z.iso.datetime({ offset: true }),
      generatedAt: z.iso.datetime({ offset: true }),
    }),
    locations: z.array(z.object({ id: z.uuid(), name: z.string() })),
    summary: z.object({
      issuedMinor: money,
      invoiceCount: count,
      recordedReceiptsMinor: money,
      receiptCount: count,
      openingChargesMinor: money,
      closingReceivablesMinor: money,
      unclassifiedCount: count,
      unclassifiedMinor: money,
    }),
    byPaymentMethod: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        methodType: z.enum(['cash', 'e_wallet', 'bank_transfer', 'card_terminal', 'other']),
        amountMinor: money,
        receiptCount: count,
      }),
    ),
  })
  .superRefine((report, context) => {
    if (
      report.byPaymentMethod.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n) !==
      BigInt(report.summary.recordedReceiptsMinor)
    )
      context.addIssue({ code: 'custom', message: 'Payment-method totals must reconcile to recorded receipts.' })
  })
export type WholesaleSettlementReport = z.infer<typeof wholesaleSettlementReportSchema>
