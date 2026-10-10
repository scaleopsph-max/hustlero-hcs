import { z } from 'zod'

const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const positiveMinor = minor.refine((value) => value > 0, 'Amount must be positive.')

export const wholesalePaymentTermSchema = z.enum(['prepaid', 'cod', 'net_7', 'net_15', 'net_30'])

export const wholesaleCreditSettingsRequestSchema = z
  .object({
    customerId: z.uuid(),
    paymentTerm: wholesalePaymentTermSchema,
    creditLimitMinor: minor,
    reason: z.string().trim().min(2).max(500),
  })
  .strict()

export const wholesaleCreditSettingsResponseSchema = z.object({
  settingsId: z.uuid(),
  customerId: z.uuid(),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  paymentTerm: wholesalePaymentTermSchema,
  creditLimitMinor: minor,
  recordedAt: z.iso.datetime({ offset: true }),
})

export const wholesaleCreditSettingsContextSchema = z.object({
  canManage: z.boolean(),
  customers: z.array(
    z
      .object({
        customerId: z.uuid(),
        customerName: z.string(),
        customerNumber: z.string(),
        settings: wholesaleCreditSettingsResponseSchema.nullable(),
      })
      .refine((customer) => customer.settings === null || customer.settings.customerId === customer.customerId, {
        message: 'Credit settings must belong to the listed customer.',
      }),
  ),
})

export type WholesaleCreditSettingsResponse = z.infer<typeof wholesaleCreditSettingsResponseSchema>
export type WholesaleCreditSettingsContext = z.infer<typeof wholesaleCreditSettingsContextSchema>

export const wholesaleOpeningReceivableRequestSchema = z
  .object({
    invoiceId: z.uuid(),
    dueDate: z.iso.date(),
    reason: z.string().trim().min(2).max(500),
  })
  .strict()

export const wholesalePaymentAllocationRequestSchema = z
  .object({
    customerId: z.uuid(),
    paymentMethodId: z.uuid(),
    amountMinor: positiveMinor,
    reference: z.string().trim().min(1).max(100),
    allocations: z
      .array(z.object({ invoiceId: z.uuid(), amountMinor: positiveMinor }).strict())
      .min(1)
      .max(500),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.allocations.map((allocation) => allocation.invoiceId)).size !== request.allocations.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate invoices are not allowed.', path: ['allocations'] })
    }
    const allocated = request.allocations.reduce((total, allocation) => total + BigInt(allocation.amountMinor), 0n)
    if (allocated !== BigInt(request.amountMinor)) {
      context.addIssue({ code: 'custom', message: 'Allocate the exact payment amount.', path: ['allocations'] })
    }
  })

export type WholesalePaymentTerm = z.infer<typeof wholesalePaymentTermSchema>
export const wholesaleOpeningReceivableResponseSchema = z.object({
  chargeId: z.uuid(),
  invoiceId: z.uuid(),
  amountMinor: positiveMinor,
  dueDate: z.iso.date(),
  status: z.literal('unpaid'),
})

export const wholesaleReceivablesContextSchema = z.object({
  canRecordOpening: z.boolean(),
  invoices: z.array(
    z
      .object({
        invoiceId: z.uuid(),
        invoiceNumber: z.string(),
        customerId: z.uuid(),
        customerName: z.string(),
        locationId: z.uuid(),
        locationName: z.string(),
        totalMinor: minor,
        classification: z.enum(['opening', 'invoice', 'unclassified']),
        eligibleForOpening: z.boolean(),
        openBalanceMinor: minor.nullable(),
        dueDate: z.iso.date().nullable(),
      })
      .superRefine((invoice, context) => {
        if (
          (invoice.classification === 'unclassified' &&
            (invoice.openBalanceMinor !== null || invoice.dueDate !== null)) ||
          (invoice.classification !== 'unclassified' &&
            (invoice.openBalanceMinor === null || invoice.dueDate === null || invoice.eligibleForOpening))
        ) {
          context.addIssue({ code: 'custom', message: 'Invoice classification and balance disagree.' })
        }
      }),
  ),
})

export type WholesaleOpeningReceivableResponse = z.infer<typeof wholesaleOpeningReceivableResponseSchema>
export type WholesaleReceivablesContext = z.infer<typeof wholesaleReceivablesContextSchema>
export type WholesaleCreditSettingsRequest = z.infer<typeof wholesaleCreditSettingsRequestSchema>
export type WholesaleOpeningReceivableRequest = z.infer<typeof wholesaleOpeningReceivableRequestSchema>
export type WholesalePaymentAllocationRequest = z.infer<typeof wholesalePaymentAllocationRequestSchema>
