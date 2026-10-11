import { z } from 'zod'
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const wholesaleStatementQuerySchema = z.strictObject({
  asOf: z.iso.date(),
  customerId: z.uuid().optional(),
  locationId: z.uuid().optional(),
})
export const wholesaleStatementSchema = z
  .object({
    scope: z.object({
      asOfDate: z.iso.date(),
      asOf: z.iso.datetime({ offset: true }),
      generatedAt: z.iso.datetime({ offset: true }),
      timezone: z.string(),
      customerId: z.uuid().nullable(),
      locationId: z.uuid().nullable(),
    }),
    customers: z.array(z.object({ id: z.uuid(), name: z.string() })),
    locations: z.array(z.object({ id: z.uuid(), name: z.string() })),
    summary: z.object({
      balanceMinor: money,
      currentMinor: money,
      days1To30Minor: money,
      days31To60Minor: money,
      days61To90Minor: money,
      over90Minor: money,
      unclassifiedCount: z.number().int().nonnegative(),
      unclassifiedMinor: money,
    }),
    invoices: z.array(
      z.object({
        invoiceId: z.uuid(),
        invoiceNumber: z.string(),
        saleId: z.uuid(),
        customerId: z.uuid(),
        customerName: z.string(),
        locationId: z.uuid(),
        locationName: z.string(),
        businessDate: z.iso.date(),
        classification: z.enum(['opening', 'invoice', 'unclassified']),
        chargedMinor: money.nullable(),
        paidMinor: money,
        balanceMinor: money.nullable(),
        dueDate: z.iso.date().nullable(),
        daysOverdue: z.number().int().nonnegative().nullable(),
        band: z.enum(['current', '1-30', '31-60', '61-90', 'over-90', 'unclassified']),
      }),
    ),
    entries: z.array(
      z.object({
        entryId: z.string(),
        recordedAt: z.iso.datetime({ offset: true }),
        invoiceId: z.uuid(),
        invoiceNumber: z.string(),
        customerName: z.string(),
        kind: z.enum(['opening', 'invoice', 'payment']),
        reference: z.string(),
        debitMinor: money,
        creditMinor: money,
      }),
    ),
  })
  .superRefine((report, context) => {
    const s = report.summary
    if (
      [s.currentMinor, s.days1To30Minor, s.days31To60Minor, s.days61To90Minor, s.over90Minor].reduce(
        (sum, n) => sum + BigInt(n),
        0n,
      ) !== BigInt(s.balanceMinor)
    )
      context.addIssue({ code: 'custom', message: 'Aging bands must reconcile.' })
    if (
      report.entries.reduce((sum, row) => sum + BigInt(row.debitMinor) - BigInt(row.creditMinor), 0n) !==
      BigInt(s.balanceMinor)
    )
      context.addIssue({ code: 'custom', message: 'Statement entries must reconcile.' })
    for (const row of report.invoices) {
      const days = row.daysOverdue
      const expectedBand =
        days === null
          ? 'unclassified'
          : days === 0
            ? 'current'
            : days <= 30
              ? '1-30'
              : days <= 60
                ? '31-60'
                : days <= 90
                  ? '61-90'
                  : 'over-90'
      if (row.band !== expectedBand)
        context.addIssue({ code: 'custom', message: 'Aging band and overdue days disagree.' })
      if (
        (report.scope.customerId && row.customerId !== report.scope.customerId) ||
        (report.scope.locationId && row.locationId !== report.scope.locationId)
      )
        context.addIssue({ code: 'custom', message: 'Invoice outside statement scope.' })
      if (
        row.classification === 'unclassified'
          ? row.balanceMinor !== null ||
            row.chargedMinor !== null ||
            row.dueDate !== null ||
            row.daysOverdue !== null ||
            row.paidMinor !== 0 ||
            row.band !== 'unclassified'
          : row.balanceMinor === null ||
            row.chargedMinor === null ||
            row.dueDate === null ||
            row.daysOverdue === null ||
            row.band === 'unclassified' ||
            BigInt(row.chargedMinor) - BigInt(row.paidMinor) !== BigInt(row.balanceMinor)
      )
        context.addIssue({ code: 'custom', message: 'Invoice classification and balance disagree.' })
    }
    if (report.invoices.reduce((sum, row) => sum + BigInt(row.balanceMinor ?? 0), 0n) !== BigInt(s.balanceMinor))
      context.addIssue({ code: 'custom', message: 'Invoice balances must reconcile.' })
    if (report.invoices.filter((row) => row.classification === 'unclassified').length !== s.unclassifiedCount)
      context.addIssue({ code: 'custom', message: 'Unclassified invoice count must reconcile.' })
  })
export type WholesaleStatement = z.infer<typeof wholesaleStatementSchema>
export type WholesaleStatementQuery = z.infer<typeof wholesaleStatementQuerySchema>
