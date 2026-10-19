import { z } from 'zod'

export const wholesaleReturnRequestSchema = z
  .object({
    invoiceId: z.uuid(),
    reason: z.string().trim().min(3).max(240),
    lines: z
      .array(
        z
          .object({
            invoiceLineId: z.uuid(),
            quantityMilli: z.number().int().min(1000).max(Number.MAX_SAFE_INTEGER).multipleOf(1000),
            returnToStock: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.lines.map((line) => line.invoiceLineId)).size !== request.lines.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate return lines are not allowed.', path: ['lines'] })
    }
  })

export type WholesaleReturnRequest = z.infer<typeof wholesaleReturnRequestSchema>

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positiveMoney = money.refine((amount) => amount > 0, 'Amount must be positive.')
export const wholesaleCreditApplyRequestSchema = z.strictObject({
  creditNoteId: z.uuid(),
  invoiceId: z.uuid(),
  amountMinor: positiveMoney,
  reason: z.string().trim().min(3).max(240),
})
export const wholesaleCreditRefundRequestSchema = z.strictObject({
  creditNoteId: z.uuid(),
  paymentMethodId: z.uuid(),
  registerSessionId: z.uuid().nullable(),
  referenceLastFour: z
    .string()
    .regex(/^[0-9]{4}$/)
    .nullable(),
  payoutConfirmed: z.literal(true),
  amountMinor: positiveMoney,
  reason: z.string().trim().min(3).max(240),
})
export const wholesaleReturnResponseSchema = z
  .object({
    creditNoteId: z.uuid(),
    invoiceId: z.uuid(),
    refundId: z.uuid(),
    amountMinor: positiveMoney,
    debtReductionMinor: money,
    newCustomerCreditMinor: money,
    openDebtMinor: money,
    cashPayoutMinor: z.literal(0),
  })
  .refine(
    (row) => BigInt(row.debtReductionMinor) + BigInt(row.newCustomerCreditMinor) === BigInt(row.amountMinor),
    'Return settlement must reconcile.',
  )
export const wholesaleCreditApplyResponseSchema = z.object({
  applicationId: z.uuid(),
  creditNoteId: z.uuid(),
  invoiceId: z.uuid(),
  amountMinor: positiveMoney,
})
export const wholesaleReturnPreviewSchema = z
  .object({
    totalCreditMinor: positiveMoney,
    debtReductionMinor: money,
    newCustomerCreditMinor: money,
    openDebtMinor: money,
    cashPayoutMinor: z.literal(0),
  })
  .refine(
    (row) => BigInt(row.debtReductionMinor) + BigInt(row.newCustomerCreditMinor) === BigInt(row.totalCreditMinor),
    'Return preview must reconcile.',
  )
export type WholesaleReturnPreview = z.infer<typeof wholesaleReturnPreviewSchema>
export const wholesaleCreditRefundResponseSchema = z.object({
  payoutId: z.uuid(),
  creditNoteId: z.uuid(),
  paymentMethodId: z.uuid(),
  registerSessionId: z.uuid().nullable(),
  referenceLastFour: z
    .string()
    .regex(/^[0-9]{4}$/)
    .nullable(),
  amountMinor: positiveMoney,
})
export const wholesaleReturnsContextSchema = z.object({
  canPost: z.boolean(),
  canApply: z.boolean(),
  canRefund: z.boolean(),
  invoices: z.array(
    z.object({
      invoiceId: z.uuid(),
      invoiceNumber: z.string(),
      customerId: z.uuid(),
      customerName: z.string(),
      locationId: z.uuid(),
      locationName: z.string(),
      openDebtMinor: money.nullable(),
      totalMinor: money,
      creditedMinor: money,
      settledMinor: money,
      valuationSupported: z.boolean(),
      lines: z.array(
        z.object({
          invoiceLineId: z.uuid(),
          name: z.string(),
          quantityMilli: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          returnedQuantityMilli: money,
          unitPriceMinor: money,
          originalTotalMinor: money,
          priorCreditMinor: money,
        }),
      ),
    }),
  ),
  notes: z.array(
    z
      .object({
        creditNoteId: z.uuid(),
        invoiceId: z.uuid(),
        customerId: z.uuid(),
        locationId: z.uuid(),
        amountMinor: positiveMoney,
        issuedCreditMinor: money,
        availableCreditMinor: money,
        commandKey: z.string().nullable(),
        payoutBlocked: z.boolean(),
        recordedAt: z.iso.datetime({ offset: true }),
      })
      .refine(
        (row) => row.availableCreditMinor <= row.issuedCreditMinor && row.issuedCreditMinor <= row.amountMinor,
        'Credit note balance is inconsistent.',
      ),
  ),
  applications: z.array(wholesaleCreditApplyResponseSchema.extend({ commandKey: z.string().nullable() })),
  payouts: z.array(wholesaleCreditRefundResponseSchema.extend({ commandKey: z.string().nullable() })),
  methods: z.array(z.object({ id: z.uuid(), name: z.string(), type: z.enum(['cash', 'e_wallet', 'bank_transfer']) })),
  sessions: z.array(z.object({ id: z.uuid(), locationId: z.uuid(), name: z.string() })),
})
export type WholesaleCreditApplyRequest = z.infer<typeof wholesaleCreditApplyRequestSchema>
export type WholesaleCreditRefundRequest = z.infer<typeof wholesaleCreditRefundRequestSchema>
export type WholesaleReturnResponse = z.infer<typeof wholesaleReturnResponseSchema>
export type WholesaleCreditApplyResponse = z.infer<typeof wholesaleCreditApplyResponseSchema>
export type WholesaleCreditRefundResponse = z.infer<typeof wholesaleCreditRefundResponseSchema>
export type WholesaleReturnsContext = z.infer<typeof wholesaleReturnsContextSchema>
