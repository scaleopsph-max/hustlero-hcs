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
            quantityMilli: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
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
export const wholesaleReturnValuationSchema = z
  .object({
    policy: z.literal('header_gross_proportional_v1'),
    grossMinor: money,
    discountMinor: money,
    taxMinor: money,
    payableMinor: money,
    originalQuantityMilli: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .refine(
    (row) =>
      row.discountMinor <= row.grossMinor &&
      BigInt(row.grossMinor) - BigInt(row.discountMinor) + BigInt(row.taxMinor) === BigInt(row.payableMinor),
    'Original valuation must reconcile.',
  )
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
export const wholesaleCreditNoteSchema = z
  .object({
    creditNoteId: z.uuid(),
    invoiceId: z.uuid(),
    refundId: z.uuid(),
    customerId: z.uuid(),
    locationId: z.uuid(),
    reason: z.string().min(3).max(240),
    amountMinor: positiveMoney,
    debtReductionMinor: money,
    issuedCreditMinor: money,
    availableCreditMinor: money,
    commandKey: z.string().nullable(),
    payoutBlocked: z.boolean(),
    recordedAt: z.iso.datetime({ offset: true }),
    lines: z
      .array(
        z.object({
          invoiceLineId: z.uuid(),
          name: z.string(),
          quantityMilli: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          amountMinor: positiveMoney,
          valuation: wholesaleReturnValuationSchema.nullable().optional(),
          returnToStock: z.boolean(),
        }),
      )
      .min(1)
      .max(200),
  })
  .refine(
    (row) =>
      row.availableCreditMinor <= row.issuedCreditMinor &&
      BigInt(row.debtReductionMinor) + BigInt(row.issuedCreditMinor) === BigInt(row.amountMinor) &&
      row.lines.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n) === BigInt(row.amountMinor) &&
      new Set(row.lines.map((line) => line.invoiceLineId)).size === row.lines.length,
    'Credit note detail is inconsistent.',
  )
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
          discountMinor: money.nullable().optional(),
          taxMinor: money.nullable().optional(),
          priorCreditMinor: money,
        }),
      ),
    }),
  ),
  notes: z.array(wholesaleCreditNoteSchema),
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
