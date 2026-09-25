import { z } from 'zod'

const id = z.uuid()
const timestamp = z.iso.datetime({ offset: true })

export const posSalesContextSchema = z.object({
  employee: z.object({ id, employeeCode: z.string(), displayName: z.string() }),
  device: z.object({
    id,
    name: z.string(),
    tenantId: id,
    tenantName: z.string(),
    locationId: id,
    locationName: z.string(),
    registerId: id,
    registerName: z.string(),
  }),
  registerSession: z
    .object({ id, openedAt: timestamp, openingCashCentavos: z.number().int().nonnegative() })
    .nullable(),
  categories: z.array(z.string()),
  items: z.array(
    z.object({
      variantId: id,
      productName: z.string(),
      variantName: z.string(),
      sku: z.string(),
      barcode: z.string().nullable(),
      category: z.string().nullable(),
      retailPriceCentavos: z.number().int().nonnegative(),
      availableMilli: z.number().int().nonnegative().nullable(),
      trackInventory: z.boolean(),
    }),
  ),
  paymentMethods: z.array(
    z.object({
      id,
      code: z.string(),
      name: z.string(),
      type: z.enum(['cash', 'e_wallet', 'bank_transfer', 'card_terminal', 'other']),
    }),
  ),
})

export const posRegisterOpenRequestSchema = z.object({ openingCashCentavos: z.number().int().nonnegative() })
export const posRegisterOpenResponseSchema = z.object({
  registerSessionId: id,
  status: z.literal('open'),
  openedAt: timestamp,
  openingCashCentavos: z.number().int().nonnegative(),
})

export const posCashSaleCompleteRequestSchema = z.object({
  lines: z
    .array(z.object({ variantId: id, quantityMilli: z.number().int().positive() }))
    .min(1)
    .max(200)
    .refine((lines) => new Set(lines.map((line) => line.variantId)).size === lines.length, 'Duplicate variants'),
  cashReceivedCentavos: z.number().int().nonnegative(),
})

export const posCashSaleCompleteResponseSchema = z.object({
  saleId: id,
  receiptNumber: z.string(),
  status: z.literal('completed'),
  subtotalCentavos: z.number().int().nonnegative(),
  totalCentavos: z.number().int().nonnegative(),
  cashReceivedCentavos: z.number().int().nonnegative(),
  changeCentavos: z.number().int().nonnegative(),
  completedAt: timestamp,
})

export const salesContextSchema = z.object({
  sales: z.array(
    z.object({
      id,
      receiptNumber: z.string(),
      status: z.enum(['completed', 'voided', 'partially_refunded', 'refunded']),
      locationName: z.string(),
      registerName: z.string(),
      employeeName: z.string(),
      itemCount: z.coerce.number().nonnegative(),
      totalCentavos: z.number().int().nonnegative(),
      refundedCentavos: z.number().int().nonnegative(),
      netCentavos: z.number().int(),
      completedAt: timestamp,
    }),
  ),
})

export const saleReceiptDetailSchema = z.object({
  id,
  receiptNumber: z.string(),
  status: z.enum(['completed', 'voided', 'partially_refunded', 'refunded']),
  locationName: z.string(),
  registerName: z.string(),
  employeeName: z.string(),
  completedAt: timestamp,
  subtotalCentavos: z.number().int().nonnegative(),
  discountCentavos: z.number().int().nonnegative(),
  taxCentavos: z.number().int().nonnegative(),
  totalCentavos: z.number().int().nonnegative(),
  refundedCentavos: z.number().int().nonnegative(),
  refundableCentavos: z.number().int().nonnegative(),
  canReverse: z.boolean(),
  reversalBlockedReason: z.string().nullable(),
  lines: z.array(
    z.object({
      id,
      productName: z.string(),
      variantName: z.string(),
      sku: z.string(),
      quantityMilli: z.number().int().positive(),
      refundedQuantityMilli: z.number().int().nonnegative(),
      refundableQuantityMilli: z.number().int().nonnegative(),
      unitPriceCentavos: z.number().int().nonnegative(),
      lineTotalCentavos: z.number().int().nonnegative(),
    }),
  ),
  payments: z.array(
    z.object({
      id,
      methodName: z.string(),
      methodType: z.enum(['cash', 'e_wallet', 'bank_transfer', 'card_terminal', 'other']),
      amountCentavos: z.number().int().positive(),
      tenderedCentavos: z.number().int().positive(),
      changeCentavos: z.number().int().nonnegative(),
      refundedCentavos: z.number().int().nonnegative(),
    }),
  ),
  reversals: z.array(
    z.object({
      id,
      type: z.enum(['refund', 'void']),
      amountCentavos: z.number().int().positive(),
      reason: z.string(),
      completedAt: timestamp,
    }),
  ),
})

export const saleRefundRequestSchema = z.object({
  reason: z.string().trim().min(3).max(240),
  lines: z
    .array(
      z.object({
        saleLineId: id,
        quantityMilli: z.number().int().positive(),
        returnToStock: z.boolean(),
      }),
    )
    .min(1)
    .max(200)
    .refine((lines) => new Set(lines.map((line) => line.saleLineId)).size === lines.length, 'Duplicate lines'),
})

export const saleVoidRequestSchema = z.object({ reason: z.string().trim().min(3).max(240) })

export const saleReversalResponseSchema = z.object({
  reversalId: id,
  saleId: id,
  receiptNumber: z.string(),
  type: z.enum(['refund', 'void']),
  saleStatus: z.enum(['voided', 'partially_refunded', 'refunded']),
  amountCentavos: z.number().int().positive(),
  completedAt: timestamp,
})

export type PosSalesContext = z.infer<typeof posSalesContextSchema>
export type PosRegisterOpenRequest = z.infer<typeof posRegisterOpenRequestSchema>
export type PosRegisterOpenResponse = z.infer<typeof posRegisterOpenResponseSchema>
export type PosCashSaleCompleteRequest = z.infer<typeof posCashSaleCompleteRequestSchema>
export type PosCashSaleCompleteResponse = z.infer<typeof posCashSaleCompleteResponseSchema>
export type SalesContext = z.infer<typeof salesContextSchema>
export type SaleReceiptDetail = z.infer<typeof saleReceiptDetailSchema>
export type SaleRefundRequest = z.infer<typeof saleRefundRequestSchema>
export type SaleVoidRequest = z.infer<typeof saleVoidRequestSchema>
export type SaleReversalResponse = z.infer<typeof saleReversalResponseSchema>
