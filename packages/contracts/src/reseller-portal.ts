import { z } from 'zod'

import { paymentProofSchema } from './files'

const uuid = z.uuid()
const minor = z.number().int().nonnegative()
const milli = z.number().int().nonnegative()
const timestamp = z.string().min(1)

export const resellerStockStatusSchema = z.enum(['in_stock', 'low_stock', 'out_of_stock'])
export const resellerFulfillmentMethodSchema = z.enum(['delivery', 'pickup'])
export const resellerPaymentPreferenceSchema = z.enum(['gcash', 'bank_transfer'])
export const resellerReviewReasonSchema = z.enum([
  'manual_review',
  'credit_settings_missing',
  'credit_review',
  'stock_insufficient',
  'credit_limit',
])
export const resellerOrderStatusSchema = z.enum([
  'submitted',
  'confirmed',
  'partially_fulfilled',
  'fulfilled',
  'cancelled',
])

// Public application form -------------------------------------------------

export const resellerPortalPublicSchema = z.object({
  tenantSlug: z.string().min(1),
  businessName: z.string().min(1),
  configured: z.boolean(),
  applicationsOpen: z.boolean(),
})

export const resellerApplicationRequestSchema = z.strictObject({
  fullName: z.string().trim().min(2).max(160),
  businessName: z.string().trim().min(2).max(160).optional(),
  email: z.email().max(254),
  phone: z
    .string()
    .trim()
    .transform((value) => value.replace(/[^0-9+]/g, ''))
    .pipe(z.string().regex(/^\+?[0-9]{7,15}$/)),
  city: z.string().trim().min(2).max(120).optional(),
  message: z.string().trim().max(1000).optional(),
})

export const resellerApplicationResponseSchema = z.object({ status: z.literal('received') })

// Reseller session, catalog, and orders -----------------------------------

export const resellerPortalSessionSchema = z.object({
  accounts: z.array(
    z.object({
      tenantId: uuid,
      tenantSlug: z.string().min(1),
      businessName: z.string().min(1),
      accountId: uuid,
      customerId: uuid,
      customerName: z.string().min(1),
      customerNumber: z.string().min(1),
      email: z.string().min(1),
    }),
  ),
})

export const resellerCatalogItemSchema = z.object({
  variantId: uuid,
  productId: uuid,
  productName: z.string().min(1),
  variantName: z.string().min(1),
  sku: z.string().min(1),
  categoryName: z.string().nullable(),
  unitPriceMinor: minor,
  srpMinor: minor,
  pricingGroupId: uuid,
  pricingGroupName: z.string().min(1),
  thresholdMilli: milli,
  stockStatus: resellerStockStatusSchema,
  /** Signed API-relative paths of the primary product photo. */
  imageUrl: z.string().nullable().optional(),
  thumbUrl: z.string().nullable().optional(),
})

export const resellerPortalCatalogSchema = z.object({
  account: z.object({
    accountId: uuid,
    customerId: uuid,
    customerName: z.string().min(1),
    businessName: z.string().min(1),
    priceListName: z.string().min(1),
    pricingType: z.enum(['wholesale', 'dealer']),
    paymentTerm: z.enum(['prepaid', 'cod', 'net_7', 'net_15', 'net_30']).nullable(),
    creditLimitMinor: minor.nullable(),
    availableCreditMinor: minor.nullable(),
    pointsBalance: z.number().int().nonnegative(),
  }),
  fulfillmentLocationName: z.string().min(1),
  items: z.array(resellerCatalogItemSchema),
})

export const resellerOrderSchema = z.object({
  id: uuid,
  orderNumber: z.string().min(1),
  status: resellerOrderStatusSchema,
  source: z.enum(['backoffice', 'reseller_portal']),
  reviewReason: resellerReviewReasonSchema.nullable(),
  reviewDecisionReason: z.string().nullable(),
  fulfillmentMethod: resellerFulfillmentMethodSchema.nullable(),
  deliveryAddress: z.string().nullable(),
  paymentPreference: resellerPaymentPreferenceSchema.nullable(),
  notes: z.string().nullable(),
  customerId: uuid,
  customerName: z.string().min(1),
  customerNumber: z.string().min(1),
  locationName: z.string().min(1),
  totalMinor: minor,
  createdAt: timestamp,
  confirmedAt: timestamp.nullable(),
  cancelledAt: timestamp.nullable(),
  lines: z.array(
    z.object({
      id: uuid,
      variantId: uuid,
      productName: z.string().min(1),
      variantName: z.string().min(1),
      sku: z.string().min(1),
      orderedQuantityMilli: milli,
      fulfilledQuantityMilli: milli,
      cancelledQuantityMilli: milli,
      unitPriceMinor: minor,
      lineTotalMinor: minor,
      stockStatus: resellerStockStatusSchema.nullable(),
    }),
  ),
  invoices: z.array(z.object({ id: uuid, invoiceNumber: z.string().min(1), totalMinor: minor, issuedAt: timestamp })),
  paymentProofs: z.array(paymentProofSchema).optional(),
})

export const resellerOrdersSchema = z.object({ orders: z.array(resellerOrderSchema) })

export const resellerOrderSubmitRequestSchema = z
  .strictObject({
    lines: z
      .array(z.strictObject({ variantId: uuid, quantityMilli: z.number().int().min(1).max(999_999_999_999) }))
      .min(1)
      .max(100)
      .refine((lines) => new Set(lines.map((line) => line.variantId)).size === lines.length, {
        message: 'Each item may appear only once.',
      }),
    fulfillmentMethod: resellerFulfillmentMethodSchema,
    deliveryAddress: z.string().trim().min(5).max(500).optional(),
    paymentPreference: resellerPaymentPreferenceSchema,
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((order) => order.fulfillmentMethod === 'pickup' || order.deliveryAddress !== undefined, {
    message: 'A delivery address is required.',
    path: ['deliveryAddress'],
  })

export const resellerOrderSubmitResponseSchema = z.object({
  salesOrderId: uuid,
  orderNumber: z.string().min(1),
  status: z.enum(['confirmed', 'submitted']),
  reviewReason: resellerReviewReasonSchema.nullable(),
  lineCount: z.number().int().positive(),
  totalMinor: minor,
})

// Back Office administration ---------------------------------------------

export const resellerPortalSettingsRequestSchema = z.strictObject({
  fulfillmentLocationId: uuid,
  defaultPriceListId: uuid.optional(),
  applicationsOpen: z.boolean(),
  autoConfirm: z.boolean(),
})

export const resellerPortalSettingsResponseSchema = z.object({
  status: z.literal('saved'),
  fulfillmentLocationId: uuid,
  defaultPriceListId: uuid.nullable(),
  applicationsOpen: z.boolean(),
  autoConfirm: z.boolean(),
})

export const resellerApplicationDecisionRequestSchema = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('approve'),
    customerId: uuid.optional(),
    priceListId: uuid,
    paymentTerm: z.enum(['prepaid', 'cod', 'net_7', 'net_15', 'net_30']),
    creditLimitMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    reason: z.string().trim().min(2).max(500).optional(),
  }),
  z.strictObject({ decision: z.literal('reject'), reason: z.string().trim().min(2).max(500) }),
])

export const resellerApplicationDecisionResponseSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  applicationId: uuid,
  accountId: uuid.optional(),
  customerId: uuid.optional(),
})

export const resellerAccountInviteRequestSchema = z.strictObject({
  customerId: uuid,
  email: z.email().max(254),
  priceListId: uuid,
})

export const resellerAccountInviteResponseSchema = z.object({
  status: z.literal('invited'),
  accountId: uuid,
  customerId: uuid,
})

export const resellerAccountStatusRequestSchema = z.strictObject({ status: z.enum(['active', 'suspended']) })
export const resellerAccountStatusResponseSchema = z.object({
  accountId: uuid,
  status: z.enum(['invited', 'active', 'suspended']),
})

export const resellerOrderReviewRequestSchema = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('approve'),
    reason: z.string().trim().min(2).max(500).optional(),
    creditOverrideId: uuid.optional(),
  }),
  z.strictObject({ decision: z.literal('reject'), reason: z.string().trim().min(2).max(500) }),
])

export const resellerOrderReviewResponseSchema = z.object({
  salesOrderId: uuid,
  status: z.enum(['confirmed', 'cancelled']),
  totalMinor: minor.optional(),
})

export const resellerPortalAdminSchema = z.object({
  tenantSlug: z.string().min(1),
  settings: z
    .object({
      fulfillmentLocationId: uuid,
      defaultPriceListId: uuid.nullable(),
      applicationsOpen: z.boolean(),
      autoConfirm: z.boolean(),
      updatedAt: timestamp,
    })
    .nullable(),
  locations: z.array(z.object({ id: uuid, code: z.string().min(1), name: z.string().min(1) })),
  priceLists: z.array(
    z.object({
      id: uuid,
      name: z.string().min(1),
      pricingType: z.enum(['wholesale', 'dealer']),
      isDefault: z.boolean(),
    }),
  ),
  resellerCustomers: z.array(
    z.object({
      id: uuid,
      customerNumber: z.string().min(1),
      fullName: z.string().min(1),
      email: z.string().nullable(),
    }),
  ),
  applications: z.array(
    z.object({
      id: uuid,
      fullName: z.string().min(1),
      businessName: z.string().nullable(),
      email: z.string().min(1),
      phone: z.string().min(1),
      city: z.string().nullable(),
      message: z.string().nullable(),
      status: z.enum(['pending', 'approved', 'rejected']),
      decisionReason: z.string().nullable(),
      reviewedAt: timestamp.nullable(),
      createdAt: timestamp,
    }),
  ),
  accounts: z.array(
    z.object({
      id: uuid,
      customerId: uuid,
      customerName: z.string().min(1),
      customerNumber: z.string().min(1),
      email: z.string().min(1),
      status: z.enum(['invited', 'active', 'suspended']),
      priceListId: uuid,
      priceListName: z.string().min(1),
      activatedAt: timestamp.nullable(),
      createdAt: timestamp,
    }),
  ),
  reviewQueue: z.array(resellerOrderSchema),
})

export type ResellerStockStatus = z.infer<typeof resellerStockStatusSchema>
export type ResellerReviewReason = z.infer<typeof resellerReviewReasonSchema>
export type ResellerPortalPublic = z.infer<typeof resellerPortalPublicSchema>
export type ResellerApplicationRequest = z.infer<typeof resellerApplicationRequestSchema>
export type ResellerApplicationResponse = z.infer<typeof resellerApplicationResponseSchema>
export type ResellerPortalSession = z.infer<typeof resellerPortalSessionSchema>
export type ResellerCatalogItem = z.infer<typeof resellerCatalogItemSchema>
export type ResellerPortalCatalog = z.infer<typeof resellerPortalCatalogSchema>
export type ResellerOrder = z.infer<typeof resellerOrderSchema>
export type ResellerOrders = z.infer<typeof resellerOrdersSchema>
export type ResellerOrderSubmitRequest = z.infer<typeof resellerOrderSubmitRequestSchema>
export type ResellerOrderSubmitResponse = z.infer<typeof resellerOrderSubmitResponseSchema>
export type ResellerPortalSettingsRequest = z.infer<typeof resellerPortalSettingsRequestSchema>
export type ResellerPortalSettingsResponse = z.infer<typeof resellerPortalSettingsResponseSchema>
export type ResellerApplicationDecisionRequest = z.infer<typeof resellerApplicationDecisionRequestSchema>
export type ResellerApplicationDecisionResponse = z.infer<typeof resellerApplicationDecisionResponseSchema>
export type ResellerAccountInviteRequest = z.infer<typeof resellerAccountInviteRequestSchema>
export type ResellerAccountInviteResponse = z.infer<typeof resellerAccountInviteResponseSchema>
export type ResellerAccountStatusRequest = z.infer<typeof resellerAccountStatusRequestSchema>
export type ResellerAccountStatusResponse = z.infer<typeof resellerAccountStatusResponseSchema>
export type ResellerOrderReviewRequest = z.infer<typeof resellerOrderReviewRequestSchema>
export type ResellerOrderReviewResponse = z.infer<typeof resellerOrderReviewResponseSchema>
export type ResellerPortalAdmin = z.infer<typeof resellerPortalAdminSchema>
