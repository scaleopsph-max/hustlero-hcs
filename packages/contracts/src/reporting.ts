import { z } from 'zod'

const id = z.uuid()
const money = z.number().int()

export const reportingFilterSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  locationId: id.nullable(),
  channel: z.enum(['all', 'pos']),
})

const reportingScopeSchema = reportingFilterSchema.extend({
  timezone: z.string().min(1),
  generatedAt: z.iso.datetime({ offset: true }),
})

const locationSchema = z.object({ id, code: z.string(), name: z.string() })

export const dashboardContextSchema = z.object({
  scope: reportingScopeSchema,
  locations: z.array(locationSchema),
  summary: z.object({
    grossSalesCentavos: money.nonnegative(),
    refundsCentavos: money.nonnegative(),
    netSalesCentavos: money,
    cogsCentavos: money,
    grossProfitCentavos: money,
    transactionCount: z.number().int().nonnegative(),
    discountCentavos: money.nonnegative(),
    taxCentavos: money.nonnegative(),
  }),
  salesTrend: z.array(
    z.object({ date: z.iso.date(), netSalesCentavos: money, transactionCount: z.number().int().nonnegative() }),
  ),
  branches: z.array(
    z.object({
      locationId: id,
      locationName: z.string(),
      netSalesCentavos: money,
      grossProfitCentavos: money,
      transactionCount: z.number().int().nonnegative(),
    }),
  ),
  inventory: z.object({
    skuCount: z.number().int().nonnegative(),
    onHandMilli: z.number().int(),
    availableMilli: z.number().int(),
    outOfStockCount: z.number().int().nonnegative(),
    valuationCentavos: money,
  }),
  registers: z.object({ openCount: z.number().int().nonnegative(), totalCount: z.number().int().nonnegative() }),
})

const breakdownSchema = z.object({
  key: z.string(),
  label: z.string(),
  quantityMilli: z.number().int().optional(),
  transactionCount: z.number().int().nonnegative(),
  grossSalesCentavos: money.nonnegative(),
  refundsCentavos: money.nonnegative(),
  netSalesCentavos: money,
  cogsCentavos: money,
  grossProfitCentavos: money,
})

export const salesReportContextSchema = z.object({
  scope: reportingScopeSchema,
  locations: z.array(locationSchema),
  summary: dashboardContextSchema.shape.summary,
  byItem: z.array(breakdownSchema.extend({ sku: z.string(), variantName: z.string() })),
  byCategory: z.array(breakdownSchema),
  byEmployee: z.array(breakdownSchema),
  byPaymentType: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      grossSalesCentavos: money.nonnegative(),
      refundsCentavos: money.nonnegative(),
      netSalesCentavos: money,
    }),
  ),
})

export const inventoryReportContextSchema = z.object({
  scope: reportingScopeSchema,
  locations: z.array(locationSchema),
  summary: z.object({
    skuCount: z.number().int().nonnegative(),
    onHandMilli: z.number().int(),
    reservedMilli: z.number().int().nonnegative(),
    availableMilli: z.number().int(),
    inTransitMilli: z.number().int().nonnegative(),
    outOfStockCount: z.number().int().nonnegative(),
    valuationCentavos: money,
  }),
  items: z.array(
    z.object({
      locationId: id,
      locationName: z.string(),
      productName: z.string(),
      variantName: z.string(),
      sku: z.string(),
      onHandMilli: z.number().int(),
      reservedMilli: z.number().int().nonnegative(),
      availableMilli: z.number().int(),
      inTransitMilli: z.number().int().nonnegative(),
      averageUnitCostCentavos: money.nullable(),
      valuationCentavos: money,
    }),
  ),
})

export type ReportingFilter = z.infer<typeof reportingFilterSchema>
export type DashboardContext = z.infer<typeof dashboardContextSchema>
export type SalesReportContext = z.infer<typeof salesReportContextSchema>
export type InventoryReportContext = z.infer<typeof inventoryReportContextSchema>
