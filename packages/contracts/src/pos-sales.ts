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
      pricingOptions: z
        .array(
          z.object({
            pricingType: z.enum(['wholesale', 'dealer']),
            priceListId: id,
            priceListName: z.string(),
            pricingGroupId: id,
            pricingGroupName: z.string(),
            thresholdMilli: z.number().int().positive(),
            unitPriceCentavos: z.number().int().nonnegative(),
            isDefault: z.boolean(),
            customerIds: z.array(id),
          }),
        )
        .default([]),
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

export const posSalePaymentRequestSchema = z.object({
  paymentMethodId: id,
  amountCentavos: z.number().int().positive(),
  tenderedCentavos: z.number().int().positive(),
})

export const posSaleCompleteRequestSchema = z.object({
  lines: z
    .array(z.object({ variantId: id, quantityMilli: z.number().int().positive() }))
    .min(1)
    .max(200)
    .refine((lines) => new Set(lines.map((line) => line.variantId)).size === lines.length, 'Duplicate variants'),
  payments: z
    .array(posSalePaymentRequestSchema)
    .min(1)
    .max(10)
    .refine(
      (payments) => new Set(payments.map((payment) => payment.paymentMethodId)).size === payments.length,
      'Duplicate payment methods',
    ),
  customerId: id.nullable().optional(),
  pricingType: z.enum(['retail', 'wholesale', 'dealer']).default('retail'),
})

export const posSaleCompleteResponseSchema = z.object({
  saleId: id,
  receiptNumber: z.string(),
  status: z.literal('completed'),
  subtotalCentavos: z.number().int().nonnegative(),
  totalCentavos: z.number().int().nonnegative(),
  cashReceivedCentavos: z.number().int().nonnegative(),
  changeCentavos: z.number().int().nonnegative(),
  payments: z.array(
    z.object({
      paymentMethodId: id,
      methodName: z.string(),
      methodType: z.enum(['cash', 'e_wallet', 'bank_transfer', 'card_terminal', 'other']),
      amountCentavos: z.number().int().positive(),
      tenderedCentavos: z.number().int().positive(),
      changeCentavos: z.number().int().nonnegative(),
    }),
  ),
  completedAt: timestamp,
  customerId: id.nullable().optional(),
  customerName: z.string().nullable().optional(),
  loyaltyEarnedPoints: z.number().int().nonnegative().default(0),
  loyaltyBalancePoints: z.number().int().nonnegative().nullable().default(null),
  pricingType: z.enum(['retail', 'wholesale', 'dealer']).default('retail'),
  priceListId: id.nullable().default(null),
  priceListName: z.string().nullable().default(null),
})

// Compatibility aliases for consumers migrating from the original cash-only contract.
export const posCashSaleCompleteRequestSchema = posSaleCompleteRequestSchema
export const posCashSaleCompleteResponseSchema = posSaleCompleteResponseSchema

export const salesContextSchema = z.object({
  sales: z.array(
    z.object({
      id,
      receiptNumber: z.string(),
      channel: z.enum(['pos', 'wholesale']).default('pos'),
      invoiceId: id.nullable().default(null),
      salesOrderId: id.nullable().default(null),
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
  channel: z.enum(['pos', 'wholesale']).default('pos'),
  invoiceId: id.nullable().default(null),
  invoiceNumber: z.string().nullable().default(null),
  salesOrderId: id.nullable().default(null),
  orderNumber: z.string().nullable().default(null),
  status: z.enum(['completed', 'voided', 'partially_refunded', 'refunded']),
  locationName: z.string(),
  registerName: z.string(),
  employeeName: z.string(),
  customerId: id.nullable().optional(),
  customerName: z.string().nullable().optional(),
  customerNumber: z.string().nullable().optional(),
  loyaltyEarnedPoints: z.number().int().nonnegative().default(0),
  loyaltyReversedPoints: z.number().int().nonnegative().default(0),
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
export type PosSalePaymentRequest = z.infer<typeof posSalePaymentRequestSchema>
export type PosSaleCompleteRequest = z.infer<typeof posSaleCompleteRequestSchema>
export type PosSaleCompleteResponse = z.infer<typeof posSaleCompleteResponseSchema>
export type PosCashSaleCompleteRequest = PosSaleCompleteRequest
export type PosCashSaleCompleteResponse = PosSaleCompleteResponse
export type SalesContext = z.infer<typeof salesContextSchema>
export type SaleReceiptDetail = z.infer<typeof saleReceiptDetailSchema>
export type SaleRefundRequest = z.infer<typeof saleRefundRequestSchema>
export type SaleVoidRequest = z.infer<typeof saleVoidRequestSchema>
export type SaleReversalResponse = z.infer<typeof saleReversalResponseSchema>
